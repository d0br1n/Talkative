import type { Coordinator } from "./coordinator";
import { decodeVoiceToAgent, encodeLink, LINK_VERSION, type AgentToVoice, type VoiceToAgent } from "../shared/link";

const REPLACED = 4003;
/** Why the voice refused the link, by close code: logged once per failure streak. */
const REFUSED: Record<number, string> = {
  4001: "wrong link secret (4001): copy linkSecret from the voice host's config.json",
  4002: `link version mismatch (4002): this agent speaks version ${LINK_VERSION}`,
};
const BUFFER_CAP = 100;
const BUFFERED: ReadonlySet<AgentToVoice["t"]> = new Set(["turnEnd", "job", "agent", "approvalDone"]);

/** 0.5 s, doubling, capped at 10 s. `n` counts failed attempts since the last welcome, from 0. */
export const defaultBackoff = (n: number): number => Math.min(10_000, 500 * 2 ** n);

/** Agent-side end of the link: dials out, authenticates, reconnects forever. */
export class LinkClient {
  private ws: WebSocket | null = null;
  private up = false;
  private running = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private buf: AgentToVoice[] = [];
  private welcomeCbs: (() => void)[] = [];
  private msgCb: (m: VoiceToAgent) => void;
  private readonly backoff: (n: number) => number;
  /** refusals already logged since the last welcome */
  private readonly refused = new Set<number>();

  constructor(
    private readonly o: {
      url: string;
      secret: string;
      onMessage: (m: VoiceToAgent) => void;
      onState: (s: "up" | "down") => void;
      backoff?: (n: number) => number;
    },
  ) {
    this.msgCb = o.onMessage;
    this.backoff = o.backoff ?? defaultBackoff;
  }

  onMessage(cb: (m: VoiceToAgent) => void): void {
    this.msgCb = cb;
  }

  onWelcome(cb: () => void): void {
    this.welcomeCbs.push(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch {}
    this.goDown();
  }

  private goDown(): void {
    if (!this.up) return;
    this.up = false;
    this.o.onState("down");
  }

  send(m: AgentToVoice): void {
    if (this.up && this.ws) {
      this.ws.send(encodeLink(m));
      return;
    }
    if (!BUFFERED.has(m.t)) return;
    this.buf.push(m);
    if (this.buf.length > BUFFER_CAP) this.buf.shift();
  }

  private connect(): void {
    if (!this.running) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.o.url);
    } catch {
      return this.lost(null, 0);
    }
    this.ws = ws;
    ws.onopen = () => ws.send(encodeLink({ t: "hello", version: LINK_VERSION, secret: this.o.secret }));
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== "string") return;
      let m: VoiceToAgent;
      try { m = decodeVoiceToAgent(ev.data); } catch { return; }
      if (m.t === "welcome") return this.up ? undefined : this.welcomed();
      if (this.up) this.msgCb(m);
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => this.lost(ws, ev.code);
  }

  private welcomed(): void {
    this.attempt = 0;
    this.refused.clear();
    this.up = true;
    this.o.onState("up");
    const queued = this.buf;
    this.buf = [];
    for (const m of queued) this.send(m);
    for (const cb of this.welcomeCbs) cb();
  }

  private lost(ws: WebSocket | null, code: number): void {
    if (ws && this.ws !== ws) return;
    this.ws = null;
    this.goDown();
    if (!this.running) return;
    if (REFUSED[code] && !this.refused.has(code)) {
      this.refused.add(code);
      console.error(`agent: the voice refused the link: ${REFUSED[code]}; still retrying`);
    }
    if (code === REPLACED) {
      this.running = false;
      console.error("replaced by a newer agent; not reconnecting");
      return;
    }
    const delay = this.backoff(this.attempt++);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }
}

/** Route voice messages to the coordinator; on every welcome, send its last state, then re-send its pending approvals. */
export function connectAgent(coordinator: Coordinator, client: LinkClient): void {
  client.onMessage((m) => {
    switch (m.t) {
      case "turn": return coordinator.turn(m.turnId, m.text, m.verbosity);
      case "interrupt": return coordinator.interrupt();
      case "newConversation": return coordinator.newConversation();
      case "settings": return coordinator.settings(m.model, m.effort);
      case "decide": return coordinator.decide(m.id, m.allow);
    }
  });
  client.onWelcome(() => {
    // a voice that restarted knows nothing: it learns the agent's state from this, never from the link alone
    const state = coordinator.agentState;
    if (state) client.send(state);
    for (const a of coordinator.pendingApprovals()) client.send(a);
  });
}
