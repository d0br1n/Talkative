import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig, loadConfig } from "../src/config";
import { writeLivekitConfig } from "../src/voice/livekit";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "talkative-cfg-"));
  process.env.TALKATIVE_HOME = join(dir, "home");
});
afterEach(() => {
  delete process.env.TALKATIVE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

const mode = (p: string) => statSync(p).mode & 0o777;

test("initConfig writes defaults, mode 600, dir 700", () => {
  const c = initConfig({ bind: "100.64.0.1", project: "/tmp/p" });
  expect(c.linkSecret).toMatch(/^[0-9a-f]{64}$/);
  expect(c.voice).toMatchObject({
    bind: "100.64.0.1", pairPort: 7890, linkPort: 7891, livekitUrl: "ws://100.64.0.1:7880", room: "talkative",
    stt: "moonshine-base", tts: "piper-medium", memoryMaxMb: 3072, verbosity: "normal",
  });
  expect(c.voice.python.endsWith("/.venv/bin/python")).toBe(true);
  expect(c.agent).toEqual({ voiceUrl: "ws://100.64.0.1:7891", project: "/tmp/p", model: "sonnet", effort: "default" });
  const p = join(process.env.TALKATIVE_HOME!, "config.json");
  expect(mode(p)).toBe(0o600);
  expect(mode(process.env.TALKATIVE_HOME!)).toBe(0o700);
  expect(loadConfig()).toEqual(c);
});

test("initConfig refuses 0.0.0.0 and writes nothing", () => {
  expect(() => initConfig({ bind: "0.0.0.0", project: "/tmp/p" })).toThrow(/0\.0\.0\.0/);
  expect(() => loadConfig()).toThrow();
});

test("loadConfig throws on missing fields and bad values", () => {
  const c = initConfig({ bind: "127.0.0.1", project: "/tmp/p" });
  const p = join(process.env.TALKATIVE_HOME!, "config.json");
  const write = (o: unknown) => writeFileSync(p, JSON.stringify(o));
  const bad = (f: (x: any) => void) => {
    const x = JSON.parse(JSON.stringify(c));
    f(x);
    write(x);
    expect(() => loadConfig()).toThrow();
  };
  bad((x) => delete x.linkSecret);
  bad((x) => delete x.voice.room);
  bad((x) => (x.voice.pairPort = "7890"));
  bad((x) => (x.voice.verbosity = "loud"));
  bad((x) => delete x.agent);
  bad((x) => (x.agent.effort = "max"));
  bad((x) => (x.voice.bind = "0.0.0.0"));
  write("nope");
  expect(() => loadConfig()).toThrow();
  expect(() => loadConfig(join(dir, "missing.json"))).toThrow();
});

test("writeLivekitConfig writes yaml and keys.json mode 600", () => {
  const r = writeLivekitConfig("100.64.0.1");
  const home = process.env.TALKATIVE_HOME!;
  expect(r.path).toBe(join(home, "livekit.yaml"));
  const keysPath = join(home, "keys.json");
  expect(mode(keysPath)).toBe(0o600);
  const keys = JSON.parse(readFileSync(keysPath, "utf8"));
  const yaml = readFileSync(r.path, "utf8");
  expect(yaml).toContain("port: 7880");
  expect(yaml).toContain("tcp_port: 7881");
  expect(yaml).toContain("port_range_start: 50000");
  expect(yaml).toContain("port_range_end: 50019");
  expect(yaml).toContain("node_ip: 100.64.0.1");
  expect(yaml).toContain(`${keys.apiKey}: ${keys.apiSecret}`);
  expect(r.dockerCommand).toContain("--network host");
  expect(r.dockerCommand).toContain("livekit/livekit-server");
  expect(r.dockerCommand).not.toContain(keys.apiSecret);
  // keys are kept on a second call
  writeLivekitConfig("100.64.0.1");
  expect(JSON.parse(readFileSync(keysPath, "utf8"))).toEqual(keys);
});
