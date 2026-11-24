import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Coordinator } from "../../src/agent/coordinator";
import { JobTracker } from "../../src/agent/jobs";
import type { AgentToVoice } from "../../src/shared/link";
import { fakeSpawn, has, until } from "./helpers";

const events = (name: string): any[] =>
  readFileSync(`test/fixtures/stream/${name}.ndjson`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => !e.fake);

function replay(name: string) {
  const t = new JobTracker();
  const out: AgentToVoice[] = [];
  const running: number[] = [];
  for (const ev of events(name)) {
    out.push(...t.observe(ev));
    running.push(t.running());
  }
  return { out, running, t };
}

describe("JobTracker", () => {
  test("subagent: one start, one end, nested bash ignored", () => {
    const { out, running, t } = replay("background-subagent");
    expect(out).toEqual([
      { t: "job", phase: "start", id: "addfdf28f1ea954ad", label: "Run four sleeps sequentially" },
      { t: "job", phase: "end", id: "addfdf28f1ea954ad", label: "Run four sleeps sequentially", summary: "SUBAGENT-DONE" },
    ]);
    expect(Math.max(...running)).toBe(1);
    expect(t.running()).toBe(0);
  });

  test("bash: one start, one end; running 1 mid-fixture, 0 at the end", () => {
    const { out, running, t } = replay("background-bash");
    expect(out.map((m: any) => m.phase)).toEqual(["start", "end"]);
    expect((out[0] as any).id).toBe((out[1] as any).id);
    expect(running[Math.floor(running.length / 2) - 1]).toBe(1);
    expect(t.running()).toBe(0);
  });

  test("label: cut to 80 chars, default when missing", () => {
    const t = new JobTracker();
    const [a] = t.observe({ type: "system", subtype: "task_started", task_id: "x", description: "y".repeat(100) });
    expect((a as any).label).toBe("y".repeat(80));
    const [b] = t.observe({ type: "system", subtype: "task_started", task_id: "z" });
    expect((b as any).label).toBe("background job");
  });

  test("unknown or nested notifications emit nothing; nested starts ignored", () => {
    const t = new JobTracker();
    expect(t.observe({ type: "system", subtype: "task_notification", task_id: "nope", summary: "s" })).toEqual([]);
    expect(t.observe({ type: "system", subtype: "task_started", task_id: "n", parent_task_id: "p" })).toEqual([]);
    expect(t.observe({ type: "system", subtype: "task_started", task_id: "o", owned_by_subagent: true })).toEqual([]);
    expect(t.observe({ type: "system", subtype: "task_notification", task_id: "n", parent_task_id: "p" })).toEqual([]);
    expect(t.observe({ type: "assistant" })).toEqual([]);
    expect(t.running()).toBe(0);
  });
});

describe("Coordinator + jobs", () => {
  const live: Coordinator[] = [];
  afterEach(() => { while (live.length) live.pop()!.stop(); });

  test("unprompted agent turn starts after job end", async () => {
    const out: AgentToVoice[] = [];
    const { spawn } = fakeSpawn("background-subagent");
    const c = new Coordinator({ spawn, cwd: process.cwd(), model: "sonnet", effort: "default", emit: (m) => out.push(m) });
    live.push(c);
    c.start();
    await until(() => has(out, { t: "agent", state: "ready" }));
    c.turn("t1", "go", "brief");
    await until(() => out.filter((m) => m.t === "turnEnd").length === 2);
    const jobs = out.filter((m) => m.t === "job");
    expect(jobs.map((m: any) => m.phase)).toEqual(["start", "end"]);
    const endAt = out.findIndex((m) => m.t === "job" && (m as any).phase === "end");
    const agentAt = out.findIndex((m) => m.t === "turnStart" && (m as any).origin === "agent");
    expect(endAt).toBeGreaterThan(-1);
    expect(agentAt).toBeGreaterThan(endAt);
  });
});
