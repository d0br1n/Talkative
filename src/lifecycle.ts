import { EventEmitter } from "node:events";

/** How long one cleanup step may take before it is logged and skipped. */
export const CLEANUP_STEP_TIMEOUT_MS = 10_000;

/** The exit code of a second signal that cuts cleanup short: 128 + the signal number. */
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 } as const;

/**
 * Named cleanup steps, run once, in reverse order of registration; one failing step never blocks the
 * rest, and one that takes longer than `stepTimeoutMs` is logged and skipped.
 */
export class Cleanup {
  private steps: [string, () => void | Promise<void>][] = [];
  private ran: Promise<void> | null = null;

  constructor(private readonly stepTimeoutMs = CLEANUP_STEP_TIMEOUT_MS) {}

  /** Cleanup has begun. */
  get running(): boolean {
    return this.ran !== null;
  }

  add(name: string, fn: () => void | Promise<void>): void {
    // a step registered after cleanup began (a startup still in flight) runs at once
    if (this.ran) void this.step(name, fn);
    else this.steps.push([name, fn]);
  }

  run(): Promise<void> {
    this.ran ??= (async () => {
      for (const [name, fn] of this.steps.reverse()) await this.step(name, fn);
    })();
    return this.ran;
  }

  private async step(name: string, fn: () => void | Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((r) => (timer = setTimeout(() => r("late"), this.stepTimeoutMs)));
    try {
      const outcome = await Promise.race([Promise.resolve().then(fn), late]);
      if (outcome === "late") console.error(`cleanup: ${name} timed out after ${this.stepTimeoutMs} ms; skipped`);
    } catch (e) {
      console.error(`cleanup: ${name} failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface RunServiceOptions {
  /** Ends the process at once (a second signal during cleanup). Defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Per cleanup step. Defaults to 10 s. */
  stepTimeoutMs?: number;
}

/**
 * Run a service. Signal handlers are installed before any startup work. `start` registers cleanup
 * as it goes and may call `lost(code)` to end the run. Resolves to the process exit code, after
 * cleanup has finished; a startup failure cleans up and rejects. A signal that arrives once cleanup
 * is under way (or a second signal) exits at once with 128 + the signal number.
 */
export async function runService(
  start: (cleanup: Cleanup, lost: (code: number) => void) => Promise<void>,
  proc: EventEmitter = process,
  o: RunServiceOptions = {},
): Promise<number> {
  const exit = o.exit ?? ((code: number) => process.exit(code));
  const cleanup = new Cleanup(o.stepTimeoutMs);
  let finish!: (code: number) => void;
  const done = new Promise<number>((r) => (finish = r));
  let signalled = false;
  const handlers = (Object.keys(SIGNAL_EXIT) as (keyof typeof SIGNAL_EXIT)[]).map((signal) => {
    const handler = () => {
      if (signalled || cleanup.running) {
        console.error(`${signal} during cleanup: exiting now`);
        return exit(SIGNAL_EXIT[signal]);
      }
      signalled = true;
      finish(0);
    };
    proc.on(signal, handler);
    return [signal, handler] as const;
  });
  const startup = start(cleanup, (code) => finish(code)).then(() => done);
  startup.catch(() => {});
  try {
    const code = await Promise.race([startup, done]);
    await cleanup.run();
    return code;
  } catch (e) {
    await cleanup.run();
    throw e;
  } finally {
    for (const [signal, handler] of handlers) proc.off(signal, handler);
  }
}
