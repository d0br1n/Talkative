import { timingSafeEqual } from "node:crypto";
import { decodeAgentToVoice, encodeLink, LINK_VERSION, type AgentToVoice, type VoiceToAgent } from "../shared/link";

type Sock = Bun.ServerWebSocket<{ authed: boolean; timer?: ReturnType<typeof setTimeout> }>;

const AUTH_TIMEOUT_MS = 5000;

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Voice-side end of the link. One agent at a time; a newer authenticated connection replaces the older. */
export class LinkServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private agent: Sock | null = null;
  private msgCb: (m: AgentToVoice) => void = () => {};
  private connCb: (connected: boolean) => void = () => {};

  constructor(private readonly o: { host: string; port: number; secret: string }) {}

  /** The bound port (useful when started with port 0). */
  get port(): number {
    return this.server?.port ?? this.o.port;
  }

  onMessage(cb: (m: AgentToVoice) => void): void {
    this.msgCb = cb;
  }

  onConnection(cb: (connected: boolean) => void): void {
    this.connCb = cb;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = Bun.serve<{ authed: boolean; timer?: ReturnType<typeof setTimeout> }>({
      hostname: this.o.host,
      port: this.o.port,
      fetch: (req, server) => {
        if (server.upgrade(req, { data: { authed: false } })) return undefined;
        return new Response("talkative link", { status: 426 });
      },
      websocket: {
        maxPayloadLength: 1_048_576,
        open: (ws) => {
          ws.data.timer = setTimeout(() => {
            if (!ws.data.authed) ws.close(4001, "unauthorized");
          }, AUTH_TIMEOUT_MS);
        },
        message: (ws, raw) => this.onRaw(ws, raw),
        close: (ws) => {
          clearTimeout(ws.data.timer);
          if (this.agent === ws) {
            this.agent = null;
            this.connCb(false);
          }
        },
      },
    });
  }

  stop(): void {
    const s = this.server;
    this.server = null;
    const had = this.agent !== null;
    this.agent = null;
    s?.stop(true);
    if (had) this.connCb(false);
  }

  send(m: VoiceToAgent): boolean {
    if (!this.agent) return false;
    this.agent.send(encodeLink(m));
    return true;
  }

  private onRaw(ws: Sock, raw: string | Buffer): void {
    let m: AgentToVoice;
    try {
      m = decodeAgentToVoice(typeof raw === "string" ? raw : raw.toString("utf8"));
    } catch {
      if (!ws.data.authed) ws.close(4001, "unauthorized");
      return;
    }
    if (!ws.data.authed) {
      if (m.t !== "hello" || !secretMatches(m.secret, this.o.secret)) return void ws.close(4001, "unauthorized");
      if (m.version !== LINK_VERSION) return void ws.close(4002, "version mismatch");
      ws.data.authed = true;
      clearTimeout(ws.data.timer);
      const old = this.agent;
      this.agent = ws;
      if (old) old.close(4003, "replaced");
      else this.connCb(true);
      ws.send(encodeLink({ t: "welcome", version: LINK_VERSION }));
      return;
    }
    if (this.agent !== ws || m.t === "hello") return;
    this.msgCb(m);
  }
}
