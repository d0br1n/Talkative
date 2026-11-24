import { EventEmitter } from "node:events";
import { expect, spyOn, test } from "bun:test";
import { Cleanup, runService } from "../src/lifecycle";

test("a signal during startup cleans up what was started and exits 0", async () => {
  const proc = new EventEmitter();
  const log: string[] = [];
  let release!: () => void;
  const p = runService(async (c) => {
    c.add("a", () => void log.push("a"));
    c.add("b", async () => void log.push("b"));
    await new Promise<void>((r) => (release = r)); // startup stuck (worker still loading)
  }, proc);
  await Bun.sleep(5);
  proc.emit("SIGTERM");
  expect(await p).toBe(0);
  expect(log).toEqual(["b", "a"]);
  expect(proc.listenerCount("SIGTERM")).toBe(0);
  release();
});

test("a step registered after cleanup began still runs", async () => {
  const c = new Cleanup();
  await c.run();
  let ran = false;
  c.add("late", () => void (ran = true));
  await Bun.sleep(5);
  expect(ran).toBe(true);
});

test("a startup failure cleans up in reverse, then rejects; one failing step does not stop the rest", async () => {
  const log: string[] = [];
  await expect(
    runService(async (c) => {
      c.add("worker", () => void log.push("worker"));
      c.add("room", () => { throw new Error("boom"); });
      c.add("link", () => void log.push("link"));
      throw new Error("startup failed");
    }, new EventEmitter()),
  ).rejects.toThrow("startup failed");
  expect(log).toEqual(["link", "worker"]);
});

test("lost(code) ends the run with that code after cleanup is awaited", async () => {
  let cleaned = false;
  const code = await runService(async (c, lost) => {
    c.add("slow", async () => { await Bun.sleep(20); cleaned = true; });
    setTimeout(() => lost(75), 5);
  }, new EventEmitter());
  expect(code).toBe(75);
  expect(cleaned).toBe(true);
});

test("cleanup runs once however many signals arrive", async () => {
  const proc = new EventEmitter();
  let n = 0;
  const exits: number[] = [];
  const p = runService(async (c) => void c.add("x", () => void n++), proc, { exit: (code) => void exits.push(code) });
  await Bun.sleep(5);
  proc.emit("SIGINT");
  proc.emit("SIGTERM");
  await p;
  expect(n).toBe(1);
  expect(exits).toEqual([143]); // the second signal: out at once
});

test("a second signal during cleanup exits at once, non-zero, without waiting for the step", async () => {
  const proc = new EventEmitter();
  const exits: number[] = [];
  let entered = false;
  const errs = spyOn(console, "error").mockImplementation(() => {});
  const p = runService(async (c) => {
    c.add("stuck", () => { entered = true; return new Promise<void>(() => {}); });
  }, proc, { exit: (code) => void exits.push(code), stepTimeoutMs: 200 });
  await Bun.sleep(5);
  proc.emit("SIGTERM");
  await Bun.sleep(5);
  expect(entered).toBe(true);
  expect(exits).toEqual([]);
  proc.emit("SIGINT");
  expect(exits).toEqual([130]);
  // (a fake exit returns: the run still ends once the stuck step times out)
  expect(await p).toBe(0);
  errs.mockRestore();
});

test("a cleanup step that hangs is logged and skipped after its timeout; the rest still run", async () => {
  const log: string[] = [];
  const errs = spyOn(console, "error").mockImplementation(() => {});
  const c = new Cleanup(20);
  c.add("first", () => void log.push("first"));
  c.add("hangs", () => new Promise<void>(() => {}));
  c.add("last", () => void log.push("last"));
  await c.run();
  const logged = errs.mock.calls.map((a) => a.join(" "));
  errs.mockRestore();
  expect(log).toEqual(["last", "first"]);
  expect(logged).toEqual(["cleanup: hangs timed out after 20 ms; skipped"]);
});

test("runService passes its step timeout to the cleanup", async () => {
  const errs = spyOn(console, "error").mockImplementation(() => {});
  let cleaned = false;
  const code = await runService(async (c, lost) => {
    c.add("after", () => void (cleaned = true));
    c.add("hangs", () => new Promise<void>(() => {}));
    setTimeout(() => lost(75), 5);
  }, new EventEmitter(), { stepTimeoutMs: 20 });
  const logged = errs.mock.calls.map((a) => a.join(" "));
  errs.mockRestore();
  expect(code).toBe(75);
  expect(cleaned).toBe(true);
  expect(logged).toEqual(["cleanup: hangs timed out after 20 ms; skipped"]);
});
