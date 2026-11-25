import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeDir } from "../../src/config";
import { PhoneLog } from "../../src/voice/phone-log";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "talkative-plog-"));
  process.env.TALKATIVE_HOME = dir;
  path = join(homeDir(), "phone.log");
});
afterEach(() => {
  delete process.env.TALKATIVE_HOME;
  rmSync(dir, { recursive: true, force: true });
});
const mode = (p: string) => statSync(p).mode & 0o777;

test("a line is written as time, level, text; the file is mode 600", () => {
  const log = new PhoneLog({ path, now: () => Date.UTC(2026, 0, 2, 3, 4, 5, 678) });
  log.write("info", "hello");
  log.write("error", "back\\slash");
  expect(readFileSync(path, "utf8")).toBe(
    "2026-01-02T03:04:05.678Z info hello\n2026-01-02T03:04:05.678Z error back\\\\slash\n",
  );
  expect(mode(path)).toBe(0o600);
});

test("1 MB of text is one line of at most 2048 bytes, ending with an ellipsis, valid UTF-8", () => {
  const log = new PhoneLog({ path });
  log.write("info", "€".repeat(400_000));
  const bytes = readFileSync(path);
  expect(bytes.length).toBeLessThanOrEqual(2048);
  const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  expect(s.endsWith("€…\n")).toBe(true); // the 2044-byte cut falls 1 byte into a 3-byte character
  expect(s.split("\n").length).toBe(2);
});

test("control characters are escaped on one line", () => {
  const log = new PhoneLog({ path });
  log.write("info", "a\nb\u0007\r");
  const s = readFileSync(path, "utf8");
  expect(s.endsWith(" info a\\nb\\x07\\r\n")).toBe(true);
  expect(s.split("\n").length).toBe(2);
});

test("past maxFileBytes the file moves to .1 and a fresh one starts, both mode 600", () => {
  let t = 0;
  const log = new PhoneLog({ path, maxFileBytes: 200, now: () => (t += 1000) });
  for (let i = 0; i < 6; i++) log.write("info", `line-${i}-${"x".repeat(20)}`);
  const old = readFileSync(`${path}.1`, "utf8");
  const cur = readFileSync(path, "utf8");
  expect(old).toContain("line-0-");
  expect(cur).toContain("line-5-");
  expect(old).not.toContain("line-5-");
  expect(statSync(path).size).toBeLessThanOrEqual(200);
  expect(mode(path)).toBe(0o600);
  expect(mode(`${path}.1`)).toBe(0o600);
});

test("20 lines per second; the rest are counted and reported in the next second", () => {
  let t = 5000;
  const log = new PhoneLog({ path, now: () => t });
  for (let i = 0; i < 25; i++) log.write("info", `m${i}`);
  expect(readFileSync(path, "utf8").trim().split("\n").length).toBe(20);
  t = 6000;
  log.write("info", "later");
  const lines = readFileSync(path, "utf8").trim().split("\n");
  expect(lines.length).toBe(22);
  expect(lines[20]).toMatch(/ info … dropped 5 lines$/);
  expect(lines[21]).toMatch(/ info later$/);
});

test("a missing directory does not make write throw, and errors print once a minute", () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    let t = 0;
    const log = new PhoneLog({ path: join(dir, "nope", "deeper", "phone.log"), now: () => t });
    expect(() => log.write("info", "x")).not.toThrow();
    t += 1000;
    expect(() => log.write("info", "y")).not.toThrow();
    expect(errors.length).toBe(1);
    t += 61_000;
    log.write("info", "z");
    expect(errors.length).toBe(2);
  } finally {
    console.error = orig;
  }
});
