import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnCommand, type Spawn } from "../../src/agent/claude";
import type { AgentToVoice } from "../../src/shared/link";

export function fakeSpawn(fixture: string): { spawn: Spawn; log: string } {
  const log = join(mkdtempSync(join(tmpdir(), "fake-claude-")), "log.ndjson");
  return {
    log,
    spawn: (args, cwd) => spawnCommand(["bun", "test/fixtures/fake-claude.ts", fixture, ...args], cwd, { FAKE_CLAUDE_LOG: log }),
  };
}

export function readLog(log: string): { args?: string[]; stdin?: any }[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const has = (out: AgentToVoice[], m: Partial<AgentToVoice>) =>
  out.some((o) => Object.entries(m).every(([k, v]) => JSON.stringify((o as any)[k]) === JSON.stringify(v)));
