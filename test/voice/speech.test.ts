import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resample, SpeechWorker } from "../../src/voice/speech";

const fake = join(import.meta.dir, "../fixtures/fake-worker.ts");
const make = () =>
  new SpeechWorker({ python: "unused", stt: "a", tts: "b", cwd: process.cwd(), command: [process.execPath, fake] });

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
