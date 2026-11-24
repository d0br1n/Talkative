#!/usr/bin/env bun
// Fake `claude -p` on stream-json. Usage: bun fake-claude.ts <fixture> [claude args...]
// <fixture> is a path, or a name in ./stream (".ndjson" optional).
// A fixture is split into segments by `{"fake":"await-user"}` lines. Segment 0 is
// printed at start; each user line on stdin releases the next segment.
// Other markers: `{"fake":"exit","code":N,"stderr":"..."}` ends the process.
// A can_use_tool control_request pauses the segment until a control_response arrives.
// Env: FAKE_CLAUDE_LOG = file that records {"args":[...]} and each {"stdin":{...}} line.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [name, ...args] = process.argv.slice(2);
const log = process.env.FAKE_CLAUDE_LOG;
const record = (o: object) => { if (log) appendFileSync(log, JSON.stringify(o) + "\n"); };
record({ args });

const dir = join(dirname(new URL(import.meta.url).pathname), "stream");
const path = [name, join(dir, name), join(dir, name + ".ndjson")].find((p) => p && existsSync(p) && !p.endsWith("/"));
if (!path) { console.error(`fake-claude: no fixture ${name}`); process.exit(2); }

const segments: string[][] = [[]];
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (!line.trim()) continue;
  if (JSON.parse(line).fake === "await-user") segments.push([]);
  else segments.at(-1)!.push(line);
}

let queue: string[] = [];
let held = false;
let next = 1;
let running = false;

const out = (line: string) => process.stdout.write(line + "\n");

async function pump() {
  if (running) return;
  running = true;
  while (queue.length && !held) {
    const line = queue.shift()!;
    const o = JSON.parse(line);
    if (o.fake === "exit") {
      if (o.stderr) process.stderr.write(o.stderr + "\n");
      process.exit(o.code ?? 0);
    }
    out(line);
    if (o.type === "control_request" && o.request?.subtype === "can_use_tool") held = true;
    await Promise.resolve();
  }
  running = false;
}

queue.push(...segments[0]);
await pump();

let buf = "";
for await (const chunk of process.stdin) {
  buf += new TextDecoder().decode(chunk, { stream: true });
  const parts = buf.split("\n");
  buf = parts.pop() ?? "";
  for (const part of parts) {
    if (!part.trim()) continue;
    const o = JSON.parse(part);
    record({ stdin: o });
    if (o.type === "user") {
      const seg = segments[Math.min(next, segments.length - 1)];
      next++;
      queue.push(...seg);
    } else if (o.type === "control_response") {
      held = false;
    } else if (o.type === "control_request" && o.request?.subtype === "interrupt") {
      out(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "interrupt" } }));
    }
    await pump();
  }
}
