import { describe, expect, test } from "bun:test";
import type { ClaudeProcess } from "../../src/agent/claude";
import { Supervisor } from "../../src/agent/supervisor";

function fakeProc(code: number, stderr = ""): { p: ClaudeProcess; exit: () => void } {
  let exit!: () => void;
  const exited = new Promise<number>((r) => (exit = () => r(code)));
  return { p: { write() {}, lines: (async function* () {})(), stderrTail: () => stderr, exited, kill() {} }, exit };
}

describe("backoff", () => {
  const s = new Supervisor({ start: () => fakeProc(0).p, onCrash() {} });
  test("formula", () => {
    expect(s.backoffMs(1)).toBe(1000);
    expect(s.backoffMs(2)).toBe(2000);
    expect(s.backoffMs(4)).toBe(8000);
    expect(s.backoffMs(10)).toBe(60000);
  });
});

describe("crash loop", () => {
  test("repeated failures back off and report stderr", async () => {
    const delays: number[] = [];
    const stderrs: string[] = [];
    let starts = 0;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const sup = new Supervisor({
      start: () => { starts++; const f = fakeProc(1, "login expired"); f.exit(); return f.p; },
      onCrash: (_c, err, d) => { delays.push(d); stderrs.push(err); if (delays.length === 4) { sup.stop(); resolveDone(); } },
      sleep: async () => {},
    });
    sup.run();
    await done;
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
    expect(stderrs[0]).toBe("login expired");
    expect(starts).toBe(4);
  });

  test("failure count resets after 60 s of uptime", async () => {
    let t = 0;
    const delays: number[] = [];
    let n = 0;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const sup = new Supervisor({
      now: () => t,
      start: () => {
        n++;
        const f = fakeProc(1);
        // process 3 lives 61 s, the rest die instantly
        if (n === 3) setTimeout(() => { t += 61_000; f.exit(); }, 0);
        else f.exit();
        return f.p;
      },
      onCrash: (_c, _e, d) => { delays.push(d); if (delays.length === 4) { sup.stop(); resolveDone(); } },
      sleep: async () => {},
    });
    sup.run();
    await done;
    expect(delays).toEqual([1000, 2000, 1000, 2000]);
  });

  test("restart() is immediate and does not report a crash", async () => {
    let starts = 0;
    let crashes = 0;
    const procs: { exit: () => void }[] = [];
    const sup = new Supervisor({
      start: () => { starts++; const f = fakeProc(0); procs.push(f); return f.p; },
      onCrash: () => { crashes++; },
      sleep: async () => {},
    });
    sup.run();
    sup.restart();
    expect(starts).toBe(2);
    procs[0]!.exit();
    await new Promise((r) => setTimeout(r, 20));
    expect(crashes).toBe(0);
    sup.stop();
  });
});
