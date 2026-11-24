import { EventEmitter } from "node:events";

/** Named cleanup steps, run once, in reverse order of registration; one failing step never blocks the rest. */
export class Cleanup {
  private steps: [string, () => void | Promise<void>][] = [];
  private ran: Promise<void> | null = null;

  add(name: string, fn: () => void | Promise<void>): void {
    // a step registered after cleanup began (a startup still in flight) runs at once
    if (this.ran) void Promise.resolve().then(fn).catch((e) => console.error(`cleanup: ${name} failed: ${(e as Error).message}`));
    else this.steps.push([name, fn]);
  }

  run(): Promise<void> {
    this.ran ??= (async () => {
      for (const [name, fn] of this.steps.reverse()) {
        try {
          await fn();
        } catch (e) {
          console.error(`cleanup: ${name} failed: ${(e as Error).message}`);
        }
      }
    })();
    return this.ran;
  }
}

/**
 * Run a service. Signal handlers are installed before any startup work. `start` registers cleanup
 * as it goes and may call `lost(code)` to end the run. Resolves to the process exit code, after
 * cleanup has finished; a startup failure cleans up and rejects.
 */
export async function runService(
  start: (cleanup: Cleanup, lost: (code: number) => void) => Promise<void>,
  proc: EventEmitter = process,
): Promise<number> {
  const cleanup = new Cleanup();
  let finish!: (code: number) => void;
  const done = new Promise<number>((r) => (finish = r));
  const onSignal = () => finish(0);
  const signals = ["SIGINT", "SIGTERM"] as const;
  for (const s of signals) proc.on(s, onSignal);
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
    for (const s of signals) proc.off(s, onSignal);
  }
}
