// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
import type { Effort } from "../shared/link";
import { SPOKEN_STYLE } from "./prompt";

export interface ClaudeProcess {
  write(obj: object): void;
  lines: AsyncIterable<any>;
  stderrTail(): string;
  exited: Promise<number>;
  kill(): void;
}

export type Spawn = (args: string[], cwd: string) => ClaudeProcess;

export function claudeArgs(o: { model: string; effort: Effort; resume?: string }): string[] {
  const args = [
    "-p",
    "--verbose",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--replay-user-messages",
    "--permission-prompt-tool", "stdio",
    "--permission-mode", "acceptEdits",
    "--model", o.model,
  ];
  if (o.effort !== "default") args.push("--effort", o.effort);
  args.push("--append-system-prompt", SPOKEN_STYLE);
  if (o.resume) args.push("--resume", o.resume);
  return args;
}

async function* jsonLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (line: string) => {
    if (!line.trim()) return undefined;
    try { return JSON.parse(line); } catch { return undefined; }
  };
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const v = parse(part);
      if (v !== undefined) yield v;
    }
  }
  const v = parse(buffer);
  if (v !== undefined) yield v;
}

/** Spawn an arbitrary command as a stream-json process (the seam tests use to run the fake). */
export function spawnCommand(cmd: string[], cwd: string, env?: Record<string, string>): ClaudeProcess {
  const proc = Bun.spawn(cmd, { cwd, ...(env ? { env: { ...process.env, ...env } } : {}), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let tail = "";
  void (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of proc.stderr) tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4000);
    } catch {}
  })();
  return {
    write(obj) {
      try {
        proc.stdin.write(JSON.stringify(obj) + "\n");
        proc.stdin.flush();
      } catch {}
    },
    lines: jsonLines(proc.stdout),
    stderrTail: () => tail,
    exited: proc.exited,
    kill: () => { try { proc.kill(); } catch {} },
  };
}

export const spawnClaude: Spawn = (args, cwd) =>
  spawnCommand([process.env.TALKATIVE_CLAUDE ?? "claude", ...args], cwd);
