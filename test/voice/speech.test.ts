import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resample, SpeechWorker } from "../../src/voice/speech";

const fake = join(import.meta.dir, "../fixtures/fake-worker.ts");
const make = (mode?: string, extra: Partial<ConstructorParameters<typeof SpeechWorker>[0]> = {}) =>
  new SpeechWorker({
    python: "unused", stt: "a", tts: "b", cwd: process.cwd(),
    command: mode ? [process.execPath, fake, mode] : [process.execPath, fake], ...extra,
  });
const logFile = () => join(mkdtempSync(join(tmpdir(), "sw-")), "spawns.log");
const spawns = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0);
const sh = (script: string) => ["bash", "-c", script];
const quiet = () => spyOn(console, "warn").mockImplementation(() => {});
const hasSystemd = !!Bun.which("systemd-run");

describe("resample", () => {
  test("16k to 48k gives 3x samples and keeps sine RMS", () => {
    const n = 16000;
    const src = new Int16Array(n).map((_, i) => Math.round(10000 * Math.sin((2 * Math.PI * 440 * i) / 16000)));
    const dst = resample(src, 16000, 48000);
    expect(dst.length).toBe(48000);
    const rms = (a: Int16Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(Math.abs(rms(dst) / rms(src) - 1)).toBeLessThan(0.02);
  });
  test("same rate returns the input values", () => {
    expect(Array.from(resample(new Int16Array([1, 2, 3]), 48000, 48000))).toEqual([1, 2, 3]);
  });
});

describe("SpeechWorker", () => {
  test("5 concurrent requests resolve in order with matching ids", async () => {
    const w = make();
    await w.start();
    const rs = await Promise.all([1, 2, 3, 4, 5].map((n) => w.transcribe(new Int16Array(n + 1))));
    expect(rs).toEqual(["n=2", "n=3", "n=4", "n=5", "n=6"]);
    w.stop();
  });

  test("synth resamples to 48k", async () => {
    const w = make();
    await w.start();
    const pcm = await w.synth("hi");
    expect(pcm.length).toBe(12);
    w.stop();
  });

  test("worker exit mid-request rejects, next call restarts", async () => {
    const w = make();
    await w.start();
    await expect(w.transcribe(new Int16Array(1))).rejects.toThrow();
    expect(await w.transcribe(new Int16Array(4))).toBe("n=4");
    w.stop();
  });
});

describe("fallback and the memory cap", () => {
  test.skipIf(!hasSystemd)("falls back to a direct launch only when the worker never started", async () => {
    const warn = quiet();
    const log = logFile();
    const w = make(undefined, { memoryMaxMb: 500, command: sh(`echo x >> ${log}; exit 1`) });
    await expect(w.start()).rejects.toThrow();
    expect(spawns(log)).toBe(2); // scoped launch, then one direct launch
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test.skipIf(!hasSystemd)("never falls back once the worker printed its starting marker", async () => {
    const log = logFile();
    const w = make(undefined, {
      memoryMaxMb: 500, command: sh(`echo x >> ${log}; echo 'worker: starting' >&2; exit 1`),
    });
    await expect(w.start()).rejects.toThrow();
    expect(spawns(log)).toBe(1);
  });

  test("stop() while ready is pending rejects and never spawns again", async () => {
    const warn = quiet();
    const log = logFile();
    const w = make(undefined, { memoryMaxMb: 500, command: sh(`echo x >> ${log}; exec sleep 5`) });
    const started = w.start();
    started.catch(() => {});
    await Bun.sleep(300);
    w.stop();
    await expect(started).rejects.toThrow();
    await Bun.sleep(300);
    expect(spawns(log)).toBe(1);
    warn.mockRestore();
  });
});

describe("timeouts", () => {
  test("startup timeout kills the worker and rejects", async () => {
    const w = make("never-ready", { startupTimeoutMs: 300 });
    await expect(w.start()).rejects.toThrow(/timed out/);
  });

  test("request timeout rejects, kills the worker, and does not wedge later calls", async () => {
    const w = make("silent", { requestTimeoutMs: 300 });
    await w.start();
    await expect(w.transcribe(new Int16Array(2))).rejects.toThrow(/timed out/);
    await expect(w.transcribe(new Int16Array(2))).rejects.toThrow(/timed out/);
    w.stop();
  });
});

describe("startup failure breaker", () => {
  test("3 failures reject immediately for 60 s, then one retry; ready resets", async () => {
    const log = logFile();
    let now = 1000;
    const w = make(undefined, {
      now: () => now, command: sh(`echo x >> ${log}; echo 'worker: starting' >&2; echo boom-tail >&2; exit 1`),
    });
    for (let i = 0; i < 3; i++) await expect(w.start()).rejects.toThrow(/boom-tail/);
    expect(spawns(log)).toBe(3);
    await expect(w.transcribe(new Int16Array(2))).rejects.toThrow(/boom-tail/);
    expect(spawns(log)).toBe(3);
    now += 59_000;
    await expect(w.start()).rejects.toThrow(/boom-tail/);
    expect(spawns(log)).toBe(3);
    now += 2_000;
    await expect(w.start()).rejects.toThrow(/boom-tail/);
    expect(spawns(log)).toBe(4); // exactly one retry
    await expect(w.start()).rejects.toThrow(/boom-tail/);
    expect(spawns(log)).toBe(4); // blocked again
  });

  test("a successful ready resets the failure count", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-"));
    const flag = join(dir, "ok");
    const log = join(dir, "log");
    // fails until the flag exists, then behaves like the fake worker
    const script = `echo x >> ${log}; echo 'worker: starting' >&2; [ -e ${flag} ] || exit 1; exec ${process.execPath} ${fake}`;
    const w = make(undefined, { command: sh(script) });
    await expect(w.start()).rejects.toThrow();
    await expect(w.start()).rejects.toThrow();
    await Bun.write(flag, "1");
    await w.start();
    expect(await w.transcribe(new Int16Array(2))).toBe("n=2");
    w.stop();
    await Bun.$`rm ${flag}`;
    for (let i = 0; i < 3; i++) await expect(w.start()).rejects.toThrow();
    expect(spawns(log)).toBe(6); // 2 + ok + 3: counting restarted at zero after ready
  });
});

describe("reader robustness", () => {
  test("a non-object JSON line does not kill the reader", async () => {
    const w = make("null-line");
    await w.start();
    expect(await w.transcribe(new Int16Array(3))).toBe("n=3");
    expect(await w.transcribe(new Int16Array(4))).toBe("n=4");
    w.stop();
  });
});

