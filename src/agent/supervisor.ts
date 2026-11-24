// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
import type { ClaudeProcess } from "./claude";

const UPTIME_RESET_MS = 60_000;

/**
 * Keeps one Claude process alive. An exit nobody asked for is a crash: report it,
 * wait the backoff, start again. Failures reset after a process lived 60 s.
 */
export class Supervisor {
  private failures = 0;
  private gen = 0;
  private proc: ClaudeProcess | null = null;
  private stopped = false;
  private readonly start: () => ClaudeProcess;
  private readonly onCrash: (code: number, stderr: string, nextDelayMs: number) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(o: {
    start: () => ClaudeProcess;
    onCrash: (code: number, stderr: string, nextDelayMs: number) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  }) {
    this.start = o.start;
    this.onCrash = o.onCrash;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  backoffMs(failures: number): number {
    return Math.min(1000 * 2 ** (failures - 1), 60_000);
  }

  get current(): ClaudeProcess | null {
    return this.proc;
  }

  /** Begin supervising. */
  run(): void {
    this.stopped = false;
    void this.loop(++this.gen);
  }

  /** Kill the process on purpose and start a fresh one at once, without backoff. */
  restart(): void {
    const old = this.proc;
    const gen = ++this.gen;
    this.stopped = false;
    this.failures = 0;
    old?.kill();
    void this.loop(gen);
  }

  stop(): void {
    this.stopped = true;
    this.gen++;
    this.proc?.kill();
    this.proc = null;
  }

  private async loop(gen: number): Promise<void> {
    while (gen === this.gen && !this.stopped) {
      let p: ClaudeProcess;
      try {
        p = this.start();
      } catch {
        // could not even spawn: treat as an instant crash
        this.failures++;
        const d = this.backoffMs(this.failures);
        this.onCrash(127, "failed to spawn", d);
        await this.sleep(d);
        continue;
      }
      this.proc = p;
      const startedAt = this.now();
      const code = await p.exited.catch(() => 1);
      if (gen !== this.gen || this.stopped) return;
      if (this.now() - startedAt >= UPTIME_RESET_MS) this.failures = 0;
      this.failures++;
      const delay = this.backoffMs(this.failures);
      this.onCrash(code, p.stderrTail(), delay);
      await this.sleep(delay);
    }
  }
}
