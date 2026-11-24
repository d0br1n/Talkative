import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCode, initConfig, loadConfig, writeCode } from "../src/config";
import { flag, UsageError } from "../src/cli";
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
  expect(yaml).toContain("tcp_port: 0");
  expect(yaml).toContain("port_range_start: 50000");
  expect(yaml).toContain("port_range_end: 50019");
  expect(yaml).toContain("node_ip: 100.64.0.1");
  expect(yaml).toContain('includes: ["100.64.0.1/32"]');
  expect(yaml).toContain('bind_addresses: ["100.64.0.1"]');
  expect(yaml).toContain(`${keys.apiKey}: ${keys.apiSecret}`);
  expect(r.dockerCommand).toContain("--network host");
  expect(r.dockerCommand).toContain("--restart unless-stopped");
  expect(r.dockerCommand).toContain("livekit/livekit-server:v");
  expect(r.dockerCommand).not.toContain(keys.apiSecret);
  // keys are kept on a second call
  writeLivekitConfig("100.64.0.1");
  expect(JSON.parse(readFileSync(keysPath, "utf8"))).toEqual(keys);
});

test("initConfig refuses to overwrite without force, and force rotates the secret", () => {
  const a = initConfig({ bind: "127.0.0.1", project: "/tmp/p" });
  expect(() => initConfig({ bind: "127.0.0.1", project: "/tmp/p" })).toThrow(/already exists/);
  expect(loadConfig().linkSecret).toBe(a.linkSecret);
  const b = initConfig({ bind: "127.0.0.1", project: "/tmp/p", force: true });
  expect(b.linkSecret).not.toBe(a.linkSecret);
});

test("clearCode empties the code file (mode 600); writeCode replaces it", () => {
  writeCode("old old old");
  clearCode();
  const p = join(process.env.TALKATIVE_HOME!, "code");
  expect(readFileSync(p, "utf8")).toBe("");
  expect(mode(p)).toBe(0o600);
  writeCode("a b c");
  expect(readFileSync(p, "utf8")).toBe("a b c\n");
});

test("`code` prints nothing stale: an empty file is an error", () => {
  clearCode();
  const run = () => Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/main.ts"), "code"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  const r = run();
  expect(r.exitCode).toBe(2);
  expect(r.stdout.toString()).toBe("");
  writeCode("a b c");
  expect(run().stdout.toString()).toBe("a b c\n");
});

test("init resolves --project to an absolute path and rejects a missing flag value", () => {
  const env = process.env;
  const main = join(import.meta.dir, "../src/main.ts");
  const ok = Bun.spawnSync([process.execPath, main, "init", "--bind", "127.0.0.1", "--project", "rel/dir"], { env, cwd: dir, stdout: "pipe", stderr: "pipe" });
  expect(ok.exitCode).toBe(0);
  expect(loadConfig().agent.project).toBe(join(dir, "rel/dir"));
  const bad = Bun.spawnSync([process.execPath, main, "init", "--force", "--bind", "--project", "x"], { env, stdout: "pipe", stderr: "pipe" });
  expect(bad.exitCode).toBe(2);
  expect(bad.stderr.toString()).toContain("--bind needs a value");
});

test("flag: value, absent, missing, or flag-looking", () => {
  expect(flag(["--a", "1"], "a")).toBe("1");
  expect(flag(["--a", "1"], "b")).toBeUndefined();
  expect(() => flag(["--a"], "a")).toThrow(UsageError);
  expect(() => flag(["--a", "--b"], "a")).toThrow(UsageError);
});
