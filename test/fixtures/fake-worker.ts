#!/usr/bin/env bun
// Fake speech worker speaking the bench.worker JSON-lines protocol.
// stt: replies "n=<samples>" (earlier ids reply later, to prove id matching).
// stt of exactly 1 sample: exits mid-request. tts: 4 samples at 16 kHz.
import { createInterface } from "node:readline";

// Modes (argv[2]): never-ready (marker, then hangs), silent (ready, never replies),
// null-line (prints a bare `null` line before every reply).
const mode = process.argv[2];
const out = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");
console.error("worker: starting");
if (mode === "never-ready") setInterval(() => {}, 1000);
else out({ ready: true, stt: "fake", tts: "fake" });
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const r = JSON.parse(line);
  if (mode === "silent") return;
  if (mode === "null-line") process.stdout.write("null\n");
  if (r.op === "stt") {
    const n = Buffer.from(r.pcm16k, "base64").length / 2;
    if (n === 1) process.exit(3);
    setTimeout(() => out({ id: r.id, text: `n=${n}` }), Math.max(0, 50 - r.id * 10));
  } else if (r.op === "tts") {
    const pcm = Buffer.from(new Int16Array([0, 1000, -1000, 2000]).buffer).toString("base64");
    out({ id: r.id, pcm, rate: 16000 });
  } else out({ id: r.id, error: "ValueError: bad op" });
});
