import { EventEmitter } from "node:events";
import { expect, test } from "bun:test";
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

test("signals are handled once cleanup runs once", async () => {
  const proc = new EventEmitter();
  let n = 0;
  const p = runService(async (c) => void c.add("x", () => void n++), proc);
  await Bun.sleep(5);
  proc.emit("SIGINT");
  proc.emit("SIGTERM");
  await p;
  expect(n).toBe(1);
});
