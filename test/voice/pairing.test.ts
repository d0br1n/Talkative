import { afterEach, expect, test } from "bun:test";
import { Pairing } from "../../src/voice/pairing";

const decodeJwt = (t: string) => JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString());

let p: Pairing | null = null;
afterEach(() => {
  p?.stop();
  p = null;
});

let clock = 1_000_000;
let written: string[] = [];
const make = (bind = "127.0.0.1") => {
  written = [];
  return (p = new Pairing({
    bind, port: 0, apiKey: "key", apiSecret: "s".repeat(32), livekitUrl: "ws://127.0.0.1:7880", room: "talkative",
    words: ["alpha", "bravo", "charlie", "delta"], now: () => clock, onCode: (code) => void written.push(code),
  }));
};
const post = (code: string) =>
  fetch(`http://127.0.0.1:${p!.port}/pair`, { method: "POST", body: JSON.stringify({ code }), headers: { "content-type": "application/json" } });

test("a right code returns a phone token for the room", async () => {
  make();
  await p!.start();
  expect(p!.code.split(" ")).toHaveLength(3);
  const r = await post(p!.code);
  expect(r.status).toBe(200);
  const body = (await r.json()) as { url: string; token: string };
  expect(body.url).toBe("ws://127.0.0.1:7880");
  const jwt = decodeJwt(body.token) as any;
  expect(jwt.sub).toBe("phone");
  expect(jwt.video).toMatchObject({ room: "talkative", roomJoin: true, canPublish: true, canSubscribe: true });
  expect(jwt.exp - jwt.nbf).toBeGreaterThanOrEqual(30 * 86400 - 5);
});

test("a wrong code is 403 and a malformed body too", async () => {
  make();
  await p!.start();
  expect((await post("echo echo echo")).status).toBe(403);
  const r = await fetch(`http://127.0.0.1:${p!.port}/pair`, { method: "POST", body: "{" });
  expect(r.status).toBe(403);
  expect((await fetch(`http://127.0.0.1:${p!.port}/other`)).status).toBe(404);
});

test("five failures lock pairing for 60 s, even for the right code", async () => {
  make();
  await p!.start();
  for (let i = 0; i < 5; i++) expect((await post("wrong")).status).toBe(403);
  expect((await post(p!.code)).status).toBe(429);
  clock += 61_000;
  expect((await post(p!.code)).status).toBe(200);
});

test("the code is regenerated at each start", async () => {
  make();
  const codes = new Set<string>();
  for (let i = 0; i < 6; i++) {
    await p!.start();
    codes.add(p!.code);
    p!.stop();
  }
  expect(codes.size).toBeGreaterThan(1);
});

test("binds only the given address", async () => {
  make("127.0.0.2");
  await p!.start();
  expect(p!.hostname).toBe("127.0.0.2");
  expect((await fetch(`http://127.0.0.2:${p!.port}/pair`, { method: "POST", body: "{}" })).status).toBe(403);
  await expect(post("x")).rejects.toThrow(); // 127.0.0.1 is not listening on that port
});

test("a body over 1 KiB is 413", async () => {
  make();
  await p!.start();
  const r = await fetch(`http://127.0.0.1:${p!.port}/pair`, { method: "POST", body: JSON.stringify({ code: "x".repeat(2000) }) });
  expect(r.status).toBe(413);
  expect((await post(p!.code)).status).toBe(200);
});

test("a large chunked body is refused before it is read", async () => {
  make();
  await p!.start();
  const chunk = new TextEncoder().encode("x".repeat(4096));
  const CHUNKS = 4096; // 16 MiB, far more than the sockets buffer
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent++ < CHUNKS) c.enqueue(chunk);
      else c.close();
    },
  });
  // no content-length: the size is known only by reading
  const r = await fetch(`http://127.0.0.1:${p!.port}/pair`, { method: "POST", body, duplex: "half" } as RequestInit).catch(() => null);
  expect(r === null || r.status === 413).toBe(true);
  expect(sent).toBeLessThan(CHUNKS);
  expect((await post(p!.code)).status).toBe(200);
});

test("a successful pair rotates the code and rewrites the code file; the old code no longer pairs", async () => {
  make();
  await p!.start();
  const first = p!.code;
  expect(written).toEqual([first]);
  expect((await post(first)).status).toBe(200);
  const second = p!.code;
  expect(second).not.toBe(first);
  expect(written).toEqual([first, second]);
  expect((await post(first)).status).toBe(403);
  expect((await post(second)).status).toBe(200);
  expect(written).toHaveLength(3);
});
