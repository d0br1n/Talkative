import { afterEach, expect, test } from "bun:test";
import { Pairing } from "../../src/voice/pairing";

const decodeJwt = (t: string) => JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString());

let p: Pairing | null = null;
afterEach(() => {
  p?.stop();
  p = null;
});

let clock = 1_000_000;
const make = (bind = "127.0.0.1") =>
  (p = new Pairing({
    bind, port: 0, apiKey: "key", apiSecret: "s".repeat(32), livekitUrl: "ws://127.0.0.1:7880", room: "talkative",
    words: ["alpha", "bravo", "charlie", "delta"], now: () => clock,
  }));
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
  expect((await post("alpha alpha alpha")).status).toBe(403);
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
