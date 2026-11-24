#!/usr/bin/env bun
// Fake speech worker speaking the bench.worker JSON-lines protocol.
// stt: replies "n=<samples>" (earlier ids reply later, to prove id matching).
// stt of exactly 1 sample: exits mid-request. tts: 4 samples at 16 kHz.
import { createInterface } from "node:readline";

const out = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");
out({ ready: true, stt: "fake", tts: "fake" });
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const r = JSON.parse(line);
  if (r.op === "stt") {
    const n = Buffer.from(r.pcm16k, "base64").length / 2;
    if (n === 1) process.exit(3);
    setTimeout(() => out({ id: r.id, text: `n=${n}` }), Math.max(0, 50 - r.id * 10));
  } else if (r.op === "tts") {
    const pcm = Buffer.from(new Int16Array([0, 1000, -1000, 2000]).buffer).toString("base64");
    out({ id: r.id, pcm, rate: 16000 });
  } else out({ id: r.id, error: "ValueError: bad op" });
});
