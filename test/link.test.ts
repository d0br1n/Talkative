import { afterEach, describe, expect, test } from "bun:test";
import { Coordinator } from "../src/agent/coordinator";
import { connectAgent, defaultBackoff, LinkClient } from "../src/agent/link-client";
import { LINK_VERSION, type AgentToVoice, type VoiceToAgent } from "../src/shared/link";
import { LinkServer } from "../src/voice/link-server";
import { fakeSpawn, has, until } from "./agent/helpers";

const SECRET = "s3cret-value";
const servers: LinkServer[] = [];
const clients: LinkClient[] = [];
const coords: Coordinator[] = [];
const raw: WebSocket[] = [];

const RealWS = globalThis.WebSocket;
let created = 0;
const wsCount = () => created;
(globalThis as any).WebSocket = class extends RealWS {
  constructor(...a: ConstructorParameters<typeof RealWS>) {
    super(...a);
    created++;
  }
};

function spyConsoleError() {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  restore.push(() => (console.error = orig));
  return () => lines.join("\n");
}
const restore: (() => void)[] = [];
afterEach(() => {
  for (const r of restore.splice(0)) r();
  for (const c of coords.splice(0)) c.stop();
  for (const c of clients.splice(0)) c.stop();
  for (const r of raw.splice(0)) try { r.close(); } catch {}
  for (const s of servers.splice(0)) s.stop();
});

async function server(port = 0, secret = SECRET) {
  const s = new LinkServer({ host: "127.0.0.1", port, secret });
  servers.push(s);
  const got: AgentToVoice[] = [];
  const conn: boolean[] = [];
  s.onMessage((m) => got.push(m));
  s.onConnection((c) => conn.push(c));
  await s.start();
  return { s, got, conn };
}

function client(port: number, secret = SECRET) {
  const got: VoiceToAgent[] = [];
  const states: string[] = [];
  const c = new LinkClient({
    url: `ws://127.0.0.1:${port}`,
    secret,
    onMessage: (m) => got.push(m),
    onState: (s) => states.push(s),
    backoff: () => 20,
  });
  clients.push(c);
  return { c, got, states };
}

function rawSocket(port: number, first: unknown) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  raw.push(ws);
  const closed = new Promise<number>((r) => (ws.onclose = (e) => r(e.code)));
  ws.onopen = () => ws.send(typeof first === "string" ? first : JSON.stringify(first));
  return { ws, closed };
}

describe("handshake", () => {
  test("welcome, connection callbacks, binds loopback", async () => {
    const { s, conn } = await server();
    expect(s.port).toBeGreaterThan(0);
    const { c, states } = client(s.port);
    c.start();
    await until(() => states.includes("up"));
    expect(conn).toEqual([true]);
    expect(s.send({ t: "interrupt" })).toBe(true);
  });

  test("send returns false with no agent", async () => {
    const { s } = await server();
    expect(s.send({ t: "interrupt" })).toBe(false);
  });

  test("wrong secret closes 4001 and the client keeps retrying", async () => {
    const { s, conn } = await server();
    const first = rawSocket(s.port, { t: "hello", version: LINK_VERSION, secret: "nope" });
    expect(await first.closed).toBe(4001);
    // same-length wrong secret too
    const r2 = rawSocket(s.port, { t: "hello", version: LINK_VERSION, secret: "x".repeat(SECRET.length) });
    expect(await r2.closed).toBe(4001);
    const { c, states } = client(s.port, "wrong");
    c.start();
    await new Promise((r) => setTimeout(r, 300));
    expect(states).toEqual([]);
    expect(conn).toEqual([]);
  });

  test("non-hello first message closes 4001", async () => {
    const { s } = await server();
    expect(await rawSocket(s.port, { t: "turnEnd", turnId: "x", ok: true }).closed).toBe(4001);
    expect(await rawSocket(s.port, "not json").closed).toBe(4001);
  });

  test("version mismatch closes 4002", async () => {
    const { s } = await server();
    expect(await rawSocket(s.port, { t: "hello", version: LINK_VERSION + 1, secret: SECRET }).closed).toBe(4002);
  });
});

describe("messages", () => {
  test("flow both ways", async () => {
    const { s, got } = await server();
    const { c, got: down, states } = client(s.port);
    c.start();
    await until(() => states.includes("up"));
    c.send({ t: "turnStart", turnId: "t1", origin: "owner" });
    await until(() => got.length === 1);
    expect(got[0]).toEqual({ t: "turnStart", turnId: "t1", origin: "owner" });
    s.send({ t: "turn", turnId: "t1", text: "hi", verbosity: "brief" });
    await until(() => down.length === 1);
    expect(down[0]).toEqual({ t: "turn", turnId: "t1", text: "hi", verbosity: "brief" });
  });

  test("second authenticated client replaces the first; the first stops for good", async () => {
    const { s, conn } = await server();
    const a = client(s.port);
    a.c.start();
    await until(() => a.states.includes("up"));
    const b = client(s.port);
    const errs = spyConsoleError();
    b.c.start();
    await until(() => b.states.includes("up"));
    await until(() => a.states.includes("down"));
    const made = wsCount();
    await new Promise((r) => setTimeout(r, 300));
    expect(wsCount()).toBe(made);
    expect(a.states).toEqual(["up", "down"]);
    expect(b.states).toEqual(["up"]);
    expect(conn).toEqual([true]);
    expect(errs()).toContain("replaced by a newer agent; not reconnecting");
    expect(s.send({ t: "interrupt" })).toBe(true);
    await until(() => b.got.length >= 1);
    expect(b.got[0]).toEqual({ t: "interrupt" });
    expect(a.got).toEqual([]);
  });
});

describe("lifecycle", () => {
  test("client stop emits down once; start after stop reconnects; double start is one socket", async () => {
    const { s } = await server();
    const { c, states } = client(s.port);
    const before = wsCount();
    c.start();
    c.start();
    expect(wsCount() - before).toBe(1);
    await until(() => states.includes("up"));
    c.stop();
    c.stop();
    expect(states).toEqual(["up", "down"]);
    c.start();
    await until(() => states.length === 3);
    expect(states).toEqual(["up", "down", "up"]);
  });

  test("server stop fires onConnection(false)", async () => {
    const { s, conn } = await server();
    const { c, states } = client(s.port);
    c.start();
    await until(() => states.includes("up"));
    s.stop();
    expect(conn).toEqual([true, false]);
  });

  test("duplicate welcome on one socket is ignored", async () => {
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("no")),
      websocket: {
        message: (ws) => {
          ws.send(JSON.stringify({ t: "welcome", version: LINK_VERSION }));
          ws.send(JSON.stringify({ t: "welcome", version: LINK_VERSION }));
        },
      },
    });
    try {
      const { c, states } = client(fake.port!);
      let welcomes = 0;
      c.onWelcome(() => welcomes++);
      c.start();
      await until(() => states.includes("up"));
      await new Promise((r) => setTimeout(r, 100));
      expect(welcomes).toBe(1);
      expect(states).toEqual(["up"]);
    } finally {
      for (const c of clients.splice(0)) c.stop();
      fake.stop(true);
    }
  });

  test("oversize first frame closes the socket", async () => {
    const { s } = await server();
    const r = rawSocket(s.port, "x".repeat(2 * 1_048_576));
    expect(await r.closed).not.toBe(4003);
  });
});

describe("reconnect", () => {
  test("buffered job messages arrive after the server restarts", async () => {
    const first = await server();
    const port = first.s.port;
    const { c, states } = client(port);
    c.start();
    await until(() => states.includes("up"));
    first.s.stop();
    await until(() => states.includes("down"));
    c.send({ t: "job", phase: "start", id: "j1", label: "build" });
    c.send({ t: "delta", turnId: "t", block: 0, text: "dropped" });
    c.send({ t: "approval", id: "a", tool: "Bash", summary: "s", detail: "d" });
    const second = await server(port);
    await until(() => second.got.length >= 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(second.got).toEqual([{ t: "job", phase: "start", id: "j1", label: "build" }]);
  });

  test("buffer holds at most 100, oldest dropped", async () => {
    const { s } = await server();
    const { c, states } = client(s.port);
    c.send({ t: "job", phase: "start", id: "x", label: "l" }); // down, never started
    for (let i = 0; i < 150; i++) c.send({ t: "job", phase: "end", id: String(i), label: "l" });
    c.start();
    const got: AgentToVoice[] = [];
    s.onMessage((m) => got.push(m));
    await until(() => states.includes("up"));
    await until(() => got.length >= 100);
    await new Promise((r) => setTimeout(r, 100));
    expect(got.length).toBe(100);
    expect((got[0] as any).id).toBe("50");
    expect((got[99] as any).id).toBe("149");
  });

  test("default backoff: 0.5 s doubling to 10 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(defaultBackoff)).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
  });
});

describe("coordinator over the link", () => {
  test("pending approval survives a link drop: re-sent once, decide resolves it", async () => {
    const first = await server();
    const port = first.s.port;
    const { c: lc, states } = client(port);
    const { spawn } = fakeSpawn("approval");
    const coord = new Coordinator({ spawn, cwd: process.cwd(), model: "sonnet", effort: "default", emit: (m) => lc.send(m) });
    coords.push(coord);
    connectAgent(coord, lc);
    lc.start();
    coord.start();
    await until(() => states.includes("up"));
    await until(() => has(first.got, { t: "agent", state: "ready" }));
    first.s.send({ t: "turn", turnId: "t1", text: "go", verbosity: "normal" });
    await until(() => has(first.got, { t: "approval", id: "req-1" }));

    first.s.stop();
    await until(() => states.includes("down"));
    const second = await server(port);
    await until(() => has(second.got, { t: "approval", id: "req-1" }));
    await new Promise((r) => setTimeout(r, 150));
    expect(second.got.filter((m) => m.t === "approval").length).toBe(1);

    second.s.send({ t: "decide", id: "req-1", allow: true });
    await until(() => has(second.got, { t: "approvalDone", id: "req-1", allow: true, by: "owner" }));
    await until(() => has(second.got, { t: "turnEnd", turnId: "t1", ok: true }));
  });
});
