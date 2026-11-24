// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
import type { AgentToVoice, Effort, Verbosity } from "../shared/link";
import { claudeArgs, type ClaudeProcess, type Spawn } from "./claude";
import { DENIED_BY_OWNER, DENIED_BY_TIMEOUT, withVerbosity } from "./prompt";
import { Supervisor } from "./supervisor";

const DETAIL_CAP = 4000;
const SUMMARY_CAP = 120;

type Pending = { msg: Extract<AgentToVoice, { t: "approval" }>; input: Record<string, unknown>; deadline: number };

function oneLine(s: string, cap = SUMMARY_CAP): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > cap ? flat.slice(0, cap - 1) + "…" : flat;
}

function summarize(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  const arg =
    pick("command") ?? pick("file_path") ?? pick("path") ?? pick("pattern") ?? pick("url") ?? pick("description") ??
    Object.values(input).find((v): v is string => typeof v === "string");
  return arg ? oneLine(`${tool}: ${arg}`) : tool;
}

export class Coordinator {
  private readonly spawn: Spawn;
  private readonly cwd: string;
  private model: string;
  private effort: Effort;
  private readonly emit: (m: AgentToVoice) => void;
  private readonly approvalTimeoutMs: number;
  private readonly now: () => number;
  private readonly supervisor: Supervisor;

  private session: string | null = null;
  private cur: ClaudeProcess | null = null;
  private readonly loggedErrors = new Set<string>();
  private readonly tickMs: number;
  private ticker: ReturnType<typeof setInterval> | null = null;

  // turn state
  private openTurn: string | null = null;
  private queued: string[] = [];
  private agentTurns = 0;
  private block = 0;
  private open = new Map<number, { block: number; type: string; name: string; id: string; json: string }>();
  private tools = new Map<string, { name: string; summary: string }>();

  private pending = new Map<string, Pending>();

  constructor(o: {
    spawn: Spawn;
    cwd: string;
    model: string;
    effort: Effort;
    emit: (m: AgentToVoice) => void;
    approvalTimeoutMs?: number;
    now?: () => number;
    tickMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.spawn = o.spawn;
    this.cwd = o.cwd;
    this.model = o.model;
    this.effort = o.effort;
    this.emit = o.emit;
    this.approvalTimeoutMs = o.approvalTimeoutMs ?? 1_800_000;
    this.now = o.now ?? Date.now;
    this.tickMs = o.tickMs ?? 1000;
    this.supervisor = new Supervisor({
      start: () => this.launch(),
      onCrash: (_code, stderr) => this.crashed(stderr),
      sleep: o.sleep,
      now: o.now,
    });
  }

  get sessionId(): string | null {
    return this.session;
  }

  start(): void {
    this.emit({ t: "agent", state: "starting" });
    this.ticker = setInterval(() => this.tick(), this.tickMs);
    (this.ticker as any).unref?.();
    this.supervisor.run();
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.supervisor.stop();
    this.cur = null;
  }

  turn(turnId: string, text: string, v: Verbosity): void {
    if (!this.cur) {
      this.emit({ t: "turnStart", turnId, origin: "owner" });
      this.emit({ t: "turnEnd", turnId, ok: false, error: "the agent is not running" });
      return;
    }
    this.cur.write({ type: "user", message: { role: "user", content: withVerbosity(text, v) } });
    if (this.openTurn === null) this.beginTurn(turnId, "owner");
    else this.queued.push(turnId);
  }

  interrupt(): void {
    // Shape from sidetone session.ts: no request_id.
    this.cur?.write({ type: "control_request", request: { subtype: "interrupt" } });
  }

  newConversation(): void {
    this.session = null;
    this.resetState("restarted");
    this.emit({ t: "agent", state: "restarting" });
    this.supervisor.restart();
  }

  settings(model?: string, effort?: Effort): void {
    if (model) this.model = model;
    if (effort) this.effort = effort;
    this.resetState("restarted");
    this.emit({ t: "agent", state: "restarting" });
    this.supervisor.restart();
  }

  decide(id: string, allow: boolean): void {
    this.tick();
    const p = this.pending.get(id);
    if (!p) return;
    this.resolve(id, allow, "owner");
  }

  pendingApprovals(): AgentToVoice[] {
    this.tick();
    return [...this.pending.values()].map((p) => p.msg);
  }

  /** Expire approvals whose deadline passed. Runs on a 1 s interval and lazily on every read. */
  tick(): void {
    const t = this.now();
    for (const [id, p] of [...this.pending]) if (t >= p.deadline) this.resolve(id, false, "timeout");
  }

  // ---- process wiring ----

  private launch(): ClaudeProcess {
    const args = claudeArgs({ model: this.model, effort: this.effort, resume: this.session ?? undefined });
    const p = this.spawn(args, this.cwd);
    this.cur = p;
    const drained = this.read(p);
    return {
      write: (o) => p.write(o),
      lines: p.lines,
      stderrTail: () => p.stderrTail(),
      kill: () => p.kill(),
      exited: Promise.all([p.exited, drained]).then(([c]) => c),
    };
  }

  private async read(p: ClaudeProcess): Promise<void> {
    try {
      for await (const ev of p.lines) {
        if (this.cur !== p) continue;
        try {
          this.handle(ev);
        } catch (err) {
          const type = String(ev?.type ?? "unknown");
          if (!this.loggedErrors.has(type)) {
            this.loggedErrors.add(type);
            console.error(`coordinator: error handling "${type}" event:`, err);
          }
        }
      }
    } catch {}
  }

  private crashed(stderr: string): void {
    this.cur = null;
    this.resetState("the agent process exited");
    if (this.supervisor.failureCount <= 1) this.emit({ t: "agent", state: "restarting" });
    else {
      const last = stderr.split("\n").map((l) => l.trim()).filter(Boolean).pop();
      this.emit({ t: "agent", state: "crashed", ...(last ? { detail: last } : {}) });
    }
  }

  /** Drop everything tied to the old process: approvals it asked, and the open turn. */
  private resetState(why: string): void {
    for (const id of [...this.pending.keys()]) this.resolve(id, false, "timeout", false);
    if (this.openTurn !== null) this.emit({ t: "turnEnd", turnId: this.openTurn, ok: false, error: why });
    for (const t of this.queued) this.emit({ t: "turnEnd", turnId: t, ok: false, error: why });
    this.openTurn = null;
    this.queued = [];
    this.open.clear();
    this.tools.clear();
  }

  // ---- stream-json -> AgentToVoice ----

  private beginTurn(turnId: string, origin: "owner" | "agent"): void {
    this.openTurn = turnId;
    this.block = 0;
    this.open.clear();
    this.emit({ t: "turnStart", turnId, origin });
  }

  private ensureTurn(): string {
    if (this.openTurn === null) {
      const next = this.queued.shift();
      if (next) this.beginTurn(next, "owner");
      else this.beginTurn(`agent-${++this.agentTurns}`, "agent");
    }
    return this.openTurn!;
  }

  private handle(ev: any): void {
    if (!ev || typeof ev !== "object") return;
    switch (ev.type) {
      case "system":
        if (ev.subtype === "init") {
          if (typeof ev.session_id === "string" && ev.session_id) this.session = ev.session_id;
          this.emit({ t: "agent", state: "ready" });
        }
        return;
      case "stream_event":
        if (ev.parent_tool_use_id) return;
        return this.streamEvent(ev.event ?? {});
      case "assistant":
        if (!ev.parent_tool_use_id) this.ensureTurn();
        return;
      case "user":
        if (ev.isReplay === true || ev.parent_tool_use_id) return;
        return this.toolResults(ev.message);
      case "result": {
        const turnId = this.openTurn ?? this.queued.shift();
        if (turnId === undefined) return;
        const ok = ev.is_error !== true;
        this.emit({
          t: "turnEnd",
          turnId,
          ok,
          ...(!ok ? { error: oneLine(typeof ev.result === "string" && ev.result ? ev.result : String(ev.subtype ?? "error"), 300) } : {}),
        });
        this.openTurn = null;
        this.open.clear();
        const next = this.queued.shift();
        if (next) this.beginTurn(next, "owner");
        return;
      }
      case "control_request":
        if (ev.request?.subtype === "can_use_tool") this.approvalRequest(ev);
        return;
      case "control_cancel_request":
        if (this.pending.has(ev.request_id)) this.resolve(ev.request_id, false, "timeout", false);
        return;
    }
  }

  private streamEvent(e: any): void {
    if (e.type === "message_start") {
      this.ensureTurn();
      this.open.clear();
    } else if (e.type === "content_block_start") {
      const turnId = this.ensureTurn();
      const cb = e.content_block ?? {};
      const entry = { block: -1, type: String(cb.type ?? ""), name: String(cb.name ?? ""), id: String(cb.id ?? ""), json: "" };
      if (entry.type === "text") {
        entry.block = this.block++;
        this.emit({ t: "blockStart", turnId, block: entry.block });
      }
      this.open.set(e.index, entry);
    } else if (e.type === "content_block_delta") {
      const entry = this.open.get(e.index);
      if (!entry || this.openTurn === null) return;
      const d = e.delta ?? {};
      if (d.type === "text_delta" && entry.type === "text" && typeof d.text === "string") {
        this.emit({ t: "delta", turnId: this.openTurn, block: entry.block, text: d.text });
      } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
        entry.json += d.partial_json;
      }
    } else if (e.type === "content_block_stop") {
      const entry = this.open.get(e.index);
      this.open.delete(e.index);
      if (!entry || this.openTurn === null) return;
      if (entry.type === "text") this.emit({ t: "blockEnd", turnId: this.openTurn, block: entry.block });
      else if (entry.type === "tool_use") {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(entry.json || "{}"); } catch {}
        const summary = summarize(entry.name, input);
        this.tools.set(entry.id, { name: entry.name, summary });
        this.emit({ t: "tool", turnId: this.openTurn, phase: "start", name: entry.name, summary });
      }
    }
  }

  private toolResults(message: any): void {
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const part of content) {
      if (part?.type !== "tool_result") continue;
      const info = this.tools.get(String(part.tool_use_id));
      this.tools.delete(String(part.tool_use_id));
      if (!info || this.openTurn === null) continue;
      this.emit({ t: "tool", turnId: this.openTurn, phase: "end", name: info.name, summary: info.summary });
    }
  }

  // ---- approvals ----
  // Request:  {type:"control_request", request_id, request:{subtype:"can_use_tool", tool_name, input}}
  // Response: {type:"control_response", response:{subtype:"success", request_id,
  //            response:{behavior:"allow", updatedInput} | {behavior:"deny", message}}}   (sidetone session.ts answer())

  private approvalRequest(ev: any): void {
    const id = String(ev.request_id ?? "");
    if (!id || this.pending.has(id)) return;
    const tool = String(ev.request.tool_name ?? "");
    const input = (ev.request.input ?? {}) as Record<string, unknown>;
    const msg = {
      t: "approval" as const,
      id,
      tool,
      summary: summarize(tool, input),
      detail: JSON.stringify(input, null, 2).slice(0, DETAIL_CAP),
    };
    this.pending.set(id, { msg, input, deadline: this.now() + this.approvalTimeoutMs });
    this.emit(msg);
  }

  private resolve(id: string, allow: boolean, by: "owner" | "timeout", answer = true): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (answer) {
      const response = allow
        ? { behavior: "allow", updatedInput: p.input }
        : { behavior: "deny", message: by === "owner" ? DENIED_BY_OWNER : DENIED_BY_TIMEOUT };
      this.cur?.write({ type: "control_response", response: { subtype: "success", request_id: id, response } });
    }
    this.emit({ t: "approvalDone", id, allow, by });
  }
}
