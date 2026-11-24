import { afterEach, describe, expect, test } from "bun:test";
import { claudeArgs, spawnCommand, type Spawn } from "../../src/agent/claude";
import { Coordinator } from "../../src/agent/coordinator";
import { DENIED_BY_OWNER, DENIED_BY_TIMEOUT, SPOKEN_STYLE, withVerbosity } from "../../src/agent/prompt";
import type { AgentToVoice } from "../../src/shared/link";
import { fakeSpawn, has, readLog, until } from "./helpers";

const live: Coordinator[] = [];
function make(fixture: string, extra: Partial<ConstructorParameters<typeof Coordinator>[0]> = {}) {
  const out: AgentToVoice[] = [];
  const { spawn, log } = fakeSpawn(fixture);
  const c = new Coordinator({ spawn, cwd: process.cwd(), model: "sonnet", effort: "default", emit: (m) => out.push(m), ...extra });
  live.push(c);
  return { c, out, log };
}
afterEach(() => { while (live.length) live.pop()!.stop(); });

const approvalDecisions = (log: string) =>
  readLog(log).filter((e) => e.stdin?.type === "control_response").map((e) => e.stdin.response);

describe("prompt + args", () => {
  test("withVerbosity", () => expect(withVerbosity("hi", "brief")).toBe("[verbosity: brief]\nhi"));
  test("claudeArgs", () => {
    const a = claudeArgs({ model: "opus", effort: "high", resume: "s9" });
    expect(a.slice(0, 11)).toEqual(["-p", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages", "--replay-user-messages", "--permission-prompt-tool", "stdio", "--permission-mode"]);
    expect(a).toContain("acceptEdits");
    expect(a).not.toContain("--bare");
    expect(a.join(" ")).toContain("--model opus --effort high --append-system-prompt " + SPOKEN_STYLE);
    expect(a.slice(-2)).toEqual(["--resume", "s9"]);
    expect(claudeArgs({ model: "m", effort: "default" })).not.toContain("--effort");
    expect(claudeArgs({ model: "m", effort: "default" })).not.toContain("--resume");
  });
});

describe("turns", () => {
  test("owner turn: input line, blocks, turnEnd", async () => {
    const { c, out, log } = make("text-turn");
    c.start();
    await until(() => has(out, { t: "agent", state: "ready" }));
    expect(out[0]).toEqual({ t: "agent", state: "starting" });
    await until(() => c.sessionId === "sess-1");
    c.turn("t1", "hi", "brief");
    await until(() => has(out, { t: "turnEnd" }));
    expect(readLog(log).find((e) => e.stdin?.type === "user")!.stdin).toEqual({ type: "user", message: { role: "user", content: "[verbosity: brief]\nhi" } });
    expect(out.slice(2)).toEqual([
      { t: "turnStart", turnId: "t1", origin: "owner" },
      { t: "blockStart", turnId: "t1", block: 0 },
      { t: "delta", turnId: "t1", block: 0, text: "Hello" },
      { t: "delta", turnId: "t1", block: 0, text: " there." },
      { t: "blockEnd", turnId: "t1", block: 0 },
      { t: "turnEnd", turnId: "t1", ok: true },
    ]);
    const args = readLog(log)[0]!.args!;
    expect(args).not.toContain("--resume");
  });

  test("ready once running: real claude prints no init until the first user message", async () => {
    const { c, out } = make("silent-until-turn");
    c.start();
    await until(() => has(out, { t: "agent", state: "ready" }));
    expect(c.sessionId).toBeNull();
    c.turn("t1", "hi", "brief");
    await until(() => has(out, { t: "turnEnd", turnId: "t1", ok: true }));
    expect(c.sessionId).toBe("sess-quiet");
  });

  test("tool blocks emit tool start/end, not a text block", async () => {
    const { c, out } = make("tool-turn");
    c.start();
    await until(() => has(out, { t: "agent", state: "ready" }));
    c.turn("t1", "list", "normal");
    await until(() => has(out, { t: "turnEnd" }));
    const tools = out.filter((m) => m.t === "tool");
    expect(tools).toEqual([
      { t: "tool", turnId: "t1", phase: "start", name: "Bash", summary: "Bash: ls -la" },
      { t: "tool", turnId: "t1", phase: "end", name: "Bash", summary: "Bash: ls -la" },
    ]);
    const blocks = out.filter((m) => m.t === "blockStart").map((m: any) => m.block);
    expect(blocks).toEqual([0, 1]);
  });

  test("assistant output with no owner turn open is an agent turn", async () => {
    const { c, out } = make("unprompted");
    c.start();
    await until(() => has(out, { t: "turnEnd" }));
    expect(out.find((m) => m.t === "turnStart")).toEqual({ t: "turnStart", turnId: "agent-1", origin: "agent" });
    expect(has(out, { t: "delta", text: "Job finished." })).toBe(true);
  });

  test("interrupt writes a control_request", async () => {
    const { c, out, log } = make("text-turn");
    c.start();
    await until(() => has(out, { t: "agent", state: "ready" }));
    c.interrupt();
    await until(() => readLog(log).some((e) => e.stdin?.request?.subtype === "interrupt"));
    expect(readLog(log).find((e) => e.stdin?.request)!.stdin).toEqual({ type: "control_request", request: { subtype: "interrupt" } });
  });
});

describe("restarts", () => {
  test("newConversation restarts without --resume", async () => {
    const { c, out, log } = make("text-turn");
    c.start();
    await until(() => c.sessionId === "sess-1");
    c.newConversation();
    await until(() => out.filter((m) => m.t === "agent" && m.state === "ready").length === 2);
    await until(() => readLog(log).filter((e) => e.args).length === 2);
    const starts = readLog(log).filter((e) => e.args);
    expect(starts.length).toBe(2);
    expect(starts[1]!.args).not.toContain("--resume");
    expect(has(out, { t: "agent", state: "restarting" })).toBe(true);
  });

  test("settings restarts with --resume and the new model", async () => {
    const { c, out, log } = make("text-turn");
    c.start();
    await until(() => c.sessionId === "sess-1");
    c.settings("opus", "high");
    await until(() => out.filter((m) => m.t === "agent" && m.state === "ready").length === 2);
    await until(() => readLog(log).filter((e) => e.args).length === 2);
    const a = readLog(log).filter((e) => e.args)[1]!.args!;
    expect(a.slice(-2)).toEqual(["--resume", "sess-1"]);
    expect(a[a.indexOf("--model") + 1]).toBe("opus");
    expect(a[a.indexOf("--effort") + 1]).toBe("high");
  });

  test("crash restarts with --resume, closes the open turn", async () => {
    const { c, out, log } = make("crash-on-turn");
    c.start();
    await until(() => c.sessionId === "sess-1");
    c.turn("t1", "hi", "brief");
    await until(() => out.filter((m) => m.t === "agent" && m.state === "ready").length === 2);
    await until(() => readLog(log).filter((e) => e.args).length === 2);
    expect(has(out, { t: "turnEnd", turnId: "t1", ok: false })).toBe(true);
    const restartingAt = out.findIndex((m) => m.t === "agent" && m.state === "restarting");
    expect(restartingAt).toBeGreaterThan(-1);
    expect(readLog(log).filter((e) => e.args)[1]!.args!.slice(-2)).toEqual(["--resume", "sess-1"]);
  });

  test("a crash loop shows no ready between its crashes", async () => {
    const { c, out } = make("crash-on-start", { sleep: async () => {} });
    c.start();
    await until(() => out.filter((m) => m.t === "agent" && m.state === "crashed").length >= 3, 8000);
    c.stop();
    const states = out.filter((m) => m.t === "agent").map((m) => (m as { state: string }).state);
    const first = states.indexOf("crashed");
    expect(states.slice(first)).not.toContain("ready");
  });

  test("after a crash, ready waits for the new process's first line", async () => {
    const { c, out } = make("crash-after-init", { sleep: async () => {} });
    c.start();
    await until(() => has(out, { t: "agent", state: "crashed" }));
    c.stop();
    const states = out.filter((m) => m.t === "agent").map((m) => (m as { state: string }).state);
    // the first spawn is ready at once; each retry is ready only once its init line arrives
    expect(states.slice(0, 4)).toEqual(["starting", "ready", "restarting", "ready"]);
  });

  /** A coordinator whose nth spawn runs the nth fixture (the last one repeats); agent states are timestamped. */
  function sequenced(fixtures: string[], readyAfterMs: number) {
    let n = 0;
    const spawn: Spawn = (args, cwd) =>
      spawnCommand(["bun", "test/fixtures/fake-claude.ts", fixtures[Math.min(n++, fixtures.length - 1)]!, ...args], cwd);
    const states: { state: string; at: number }[] = [];
    const c = new Coordinator({
      spawn, cwd: process.cwd(), model: "sonnet", effort: "default", sleep: async () => {}, readyAfterMs,
      emit: (m) => { if (m.t === "agent") states.push({ state: m.state, at: performance.now() }); },
    });
    live.push(c);
    return { c, states };
  }

  test("after a crash, a respawn that stays up silent is ready after readyAfterMs", async () => {
    const { c, states } = sequenced(["crash-on-start", "silent-until-turn"], 200);
    c.start();
    await until(() => states.filter((s) => s.state === "ready").length === 2);
    const restarting = states.find((s) => s.state === "restarting")!;
    const ready = states.filter((s) => s.state === "ready")[1]!;
    expect(states.map((s) => s.state)).toEqual(["starting", "ready", "restarting", "ready"]);
    expect(ready.at - restarting.at).toBeGreaterThanOrEqual(180);
  });

  test("after a crash, a respawn that prints first is ready once, not again when the timer would fire", async () => {
    const { c, states } = sequenced(["crash-on-start", "text-turn"], 400);
    c.start();
    await until(() => states.filter((s) => s.state === "ready").length === 2);
    const restarting = states.find((s) => s.state === "restarting")!;
    expect(states.filter((s) => s.state === "ready")[1]!.at - restarting.at).toBeLessThan(400);
    await Bun.sleep(600);
    expect(states.map((s) => s.state)).toEqual(["starting", "ready", "restarting", "ready"]);
  });

  test("repeated start failures emit crashed with the last stderr line", async () => {
    const { c, out } = make("crash-on-start");
    c.start();
    await until(() => has(out, { t: "agent", state: "crashed" }), 8000);
    expect(has(out, { t: "agent", state: "restarting" })).toBe(true);
    expect(has(out, { t: "agent", state: "crashed", detail: "error: login expired" })).toBe(true);
  });
});

describe("approvals", () => {
  async function pendingOne(extra: Partial<ConstructorParameters<typeof Coordinator>[0]> = {}) {
    const m = make("approval", extra);
    m.c.start();
    await until(() => has(m.out, { t: "agent", state: "ready" }));
    m.c.turn("t1", "push", "brief");
    await until(() => has(m.out, { t: "approval" }));
    return m;
  }

  test("approval is held and forwarded", async () => {
    const { c, out } = await pendingOne();
    const a = out.find((m) => m.t === "approval") as any;
    expect(a.id).toBe("req-1");
    expect(a.tool).toBe("Bash");
    expect(a.summary).toBe("Bash: git push origin main");
    expect(JSON.parse(a.detail)).toEqual({ command: "git push origin main" });
    expect(c.pendingApprovals()).toEqual([a]);
    expect(has(out, { t: "turnEnd" })).toBe(false);
  });

  test("allow answers with the original input", async () => {
    const { c, out, log } = await pendingOne();
    c.decide("req-1", true);
    await until(() => has(out, { t: "turnEnd" }));
    expect(approvalDecisions(log)).toEqual([
      { subtype: "success", request_id: "req-1", response: { behavior: "allow", updatedInput: { command: "git push origin main" } } },
    ]);
    expect(has(out, { t: "approvalDone", id: "req-1", allow: true, by: "owner" })).toBe(true);
    expect(c.pendingApprovals()).toEqual([]);
  });

  test("deny carries the owner message", async () => {
    const { c, out, log } = await pendingOne();
    c.decide("req-1", false);
    await until(() => has(out, { t: "turnEnd" }));
    expect(approvalDecisions(log)).toEqual([{ subtype: "success", request_id: "req-1", response: { behavior: "deny", message: DENIED_BY_OWNER } }]);
    expect(has(out, { t: "approvalDone", id: "req-1", allow: false, by: "owner" })).toBe(true);
  });

  test("timeout denies with the timeout message (injected clock)", async () => {
    let t = 1000;
    const { c, out, log } = await pendingOne({ now: () => t, approvalTimeoutMs: 1_800_000 });
    t += 1_799_999;
    expect(c.pendingApprovals().length).toBe(1);
    t += 1;
    expect(c.pendingApprovals()).toEqual([]);
    await until(() => has(out, { t: "turnEnd" }));
    expect(approvalDecisions(log)).toEqual([{ subtype: "success", request_id: "req-1", response: { behavior: "deny", message: DENIED_BY_TIMEOUT } }]);
    expect(has(out, { t: "approvalDone", id: "req-1", allow: false, by: "timeout" })).toBe(true);
    c.decide("req-1", true); // late decide after expiry: ignored
    expect(out.filter((m) => m.t === "approvalDone").length).toBe(1);
  });

  test("a late allow after the deadline is not honoured", async () => {
    let t = 0;
    const { c, out, log } = await pendingOne({ now: () => t, approvalTimeoutMs: 100 });
    t = 100;
    c.decide("req-1", true);
    await until(() => has(out, { t: "turnEnd" }));
    expect(approvalDecisions(log)[0]!.response.behavior).toBe("deny");
  });

  test("a second decide is ignored", async () => {
    const { c, out, log } = await pendingOne();
    c.decide("req-1", true);
    c.decide("req-1", false);
    await until(() => has(out, { t: "turnEnd" }));
    expect(approvalDecisions(log).length).toBe(1);
    expect(out.filter((m) => m.t === "approvalDone").length).toBe(1);
  });

  test("an unknown id is ignored", async () => {
    const { c, out, log } = await pendingOne();
    c.decide("nope", true);
    expect(approvalDecisions(log).length).toBe(0);
    expect(out.filter((m) => m.t === "approvalDone").length).toBe(0);
    expect(c.pendingApprovals().length).toBe(1);
  });

  test("pending approvals are dropped on a restart", async () => {
    const { c, out, log } = await pendingOne();
    c.newConversation();
    expect(has(out, { t: "approvalDone", id: "req-1", allow: false, by: "timeout" })).toBe(true);
    expect(c.pendingApprovals()).toEqual([]);
    await until(() => out.filter((m) => m.t === "agent" && m.state === "ready").length === 2);
    c.decide("req-1", true);
    expect(approvalDecisions(log).length).toBe(0);
  });
});

describe("robustness", () => {
  test("a throwing emit does not stop later events", async () => {
    const out: AgentToVoice[] = [];
    const { spawn } = fakeSpawn("text-turn");
    const errs = console.error;
    console.error = () => {};
    const c = new Coordinator({
      spawn, cwd: process.cwd(), model: "sonnet", effort: "default",
      emit: (m) => { if (m.t === "delta" && m.text === "Hello") throw new Error("socket closed"); out.push(m); },
    });
    live.push(c);
    try {
      c.start();
      await until(() => has(out, { t: "agent", state: "ready" }));
      c.turn("t1", "hi", "brief");
      await until(() => has(out, { t: "turnEnd" }));
      expect(has(out, { t: "delta", text: " there." })).toBe(true);
      expect(has(out, { t: "blockEnd" })).toBe(true);
    } finally {
      console.error = errs;
    }
  });

  test("the interval ticker expires approvals without decide/pendingApprovals", async () => {
    let t = 0;
    const m = make("approval", { now: () => t, approvalTimeoutMs: 1000, tickMs: 10 });
    m.c.start();
    await until(() => has(m.out, { t: "agent", state: "ready" }));
    m.c.turn("t1", "push", "brief");
    await until(() => has(m.out, { t: "approval" }));
    t = 1000;
    await until(() => has(m.out, { t: "approvalDone", id: "req-1", allow: false, by: "timeout" }));
    await until(() => approvalDecisions(m.log).length === 1);
    expect(approvalDecisions(m.log)[0]!.response).toEqual({ behavior: "deny", message: DENIED_BY_TIMEOUT });
  });

  test("a process that inits then dies repeatedly reports crashed", async () => {
    const m = make("crash-after-init", { sleep: async () => {} });
    m.c.start();
    await until(() => has(m.out, { t: "agent", state: "crashed", detail: "error: died after init" }));
    expect(has(m.out, { t: "agent", state: "restarting" })).toBe(true);
  });
});

describe("final review fixes", () => {
  test("a failed turn's text reaches turnEnd.error: an unstreamed assistant message, an is_error result, a synthetic error", async () => {
    const { c, out } = make("error-turn");
    c.start();
    await until(() => c.sessionId === "sess-err");
    c.turn("t1", "hi", "brief");
    await until(() => has(out, { t: "turnEnd", turnId: "t1" }));
    c.turn("t2", "again", "brief");
    await until(() => has(out, { t: "turnEnd", turnId: "t2" }));
    c.turn("t3", "once more", "brief");
    await until(() => has(out, { t: "turnEnd", turnId: "t3" }));
    expect(out.filter((m) => m.t === "turnEnd")).toEqual([
      { t: "turnEnd", turnId: "t1", ok: false, error: "Invalid API key · Please run /login" },
      { t: "turnEnd", turnId: "t2", ok: false, error: "Prompt is too long" },
      { t: "turnEnd", turnId: "t3", ok: false, error: "API Error: 529 Overloaded" },
    ]);
  });

  test("a streamed reply's own text is not mistaken for an error", async () => {
    const { c, out } = make("text-turn");
    c.start();
    await until(() => c.sessionId === "sess-1");
    c.turn("t1", "hi", "brief");
    await until(() => has(out, { t: "turnEnd" }));
    expect(out.filter((m) => m.t === "turnEnd")).toEqual([{ t: "turnEnd", turnId: "t1", ok: true }]);
  });

  test("each crash logs its exit code and stderr tail once", async () => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      const { c, out } = make("crash-on-start", { sleep: async () => {} });
      c.start();
      await until(() => out.filter((m) => m.t === "agent" && m.state === "crashed").length >= 2, 8000);
      c.stop();
      const crashes = out.filter((m) => m.t === "agent" && (m.state === "crashed" || m.state === "restarting")).length;
      const logged = lines.filter((l) => l.includes("claude exited"));
      expect(logged.length).toBe(crashes);
      expect(logged[0]).toContain("code 1");
      expect(logged[0]).toContain("error: login expired");
    } finally {
      console.error = orig;
    }
  });

  test("agentState is the last agent message emitted, detail included", async () => {
    let n = 0;
    // the second crash's backoff never ends: the coordinator stays crashed
    const { c, out } = make("crash-on-start", { sleep: () => (++n >= 2 ? new Promise<void>(() => {}) : Promise.resolve()) });
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(c.agentState).toBeNull();
      c.start();
      await until(() => has(out, { t: "agent", state: "crashed" }), 8000);
      expect(c.agentState).toEqual({ t: "agent", state: "crashed", detail: "error: login expired" });
    } finally {
      console.error = quiet;
    }
  });
});
