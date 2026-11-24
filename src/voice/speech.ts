// Client for the Python speech worker (bench.worker): JSON lines over stdin/stdout.
const OUT_RATE = 48000;

export interface SpeechWorkerOptions {
  python: string;
  stt: string;
  tts: string;
  memoryMaxMb?: number;
  cwd: string;
  /** Test hook: replaces `python -m bench.worker --stt .. --tts ..`. */
  command?: string[];
  /** spawn → ready limit, default 120 s. */
  startupTimeoutMs?: number;
  /** per-request limit, default 30 s. */
  requestTimeoutMs?: number;
  /** Injectable clock for the startup-failure breaker. */
  now?: () => number;
}

const STARTED_MARKER = "worker: starting";
const MAX_STARTUP_FAILURES = 3;
const BREAKER_MS = 60_000;

/** Linear-interpolation resample of mono int16 PCM. */
export function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm.slice();
  const n = Math.round((pcm.length * to) / from);
  const out = new Int16Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.min(Math.floor(pos), pcm.length - 1);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const f = pos - i0;
    out[i] = Math.round(pcm[i0]! * (1 - f) + pcm[i1]! * f);
  }
  return out;
}

const b64 = (pcm: Int16Array) => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString("base64");
const unb64 = (s: string): Int16Array => {
  const b = Buffer.from(s, "base64");
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

interface Pending {
  resolve: (r: any) => void;
  reject: (e: Error) => void;
}

interface Running {
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  pending: Map<number, Pending>;
  ready: Promise<void>;
  dead: boolean;
  started: boolean;
  timedOut: boolean;
  stderrTail: () => string;
}

export class SpeechWorker {
  private cur: Running | null = null;
  private nextId = 1;
  private chain: Promise<unknown> = Promise.resolve();
  private warned = false;
  private stopped = false;
  private failures = 0;
  private lastFailAt = 0;
  private lastTail = "";

  constructor(private o: SpeechWorkerOptions) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (this.cur && !this.cur.dead) return this.cur.ready;
    await this.spawn();
  }

  stop(): void {
    this.stopped = true;
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    c.dead = true;
    for (const p of c.pending.values()) p.reject(new Error("speech worker stopped"));
    c.pending.clear();
    c.proc.kill();
  }

  transcribe(pcm16k: Int16Array): Promise<string> {
    return this.call({ op: "stt", pcm16k: b64(pcm16k) }).then((r) => r.text as string);
  }

  async synth(text: string): Promise<Int16Array> {
    const r = await this.call({ op: "tts", text });
    return resample(unb64(r.pcm), r.rate, OUT_RATE);
  }

  private baseCommand(): string[] {
    return this.o.command ?? [this.o.python, "-m", "bench.worker", "--stt", this.o.stt, "--tts", this.o.tts];
  }

  private async spawn(direct = false): Promise<void> {
    if (this.stopped) throw new Error("speech worker stopped");
    if (this.failures >= MAX_STARTUP_FAILURES && this.now() - this.lastFailAt < BREAKER_MS) {
      throw new Error(
        `speech worker unavailable after ${this.failures} startup failures (retry in ` +
          `${Math.ceil((BREAKER_MS - (this.now() - this.lastFailAt)) / 1000)} s): ${this.lastTail}`,
      );
    }
    const base = this.baseCommand();
    const systemd = Bun.which("systemd-run");
    const useSystemd = !direct && this.o.memoryMaxMb !== undefined && systemd !== null;
    if (this.o.memoryMaxMb !== undefined && systemd === null && !this.warned) {
      this.warned = true;
      console.warn("speech worker: systemd-run unavailable, running without a memory cap");
    }
    const cmd = useSystemd
      ? [systemd!, "--user", "--scope", "-q", "-p", `MemoryMax=${this.o.memoryMaxMb}M`, ...base]
      : base;
    const proc = Bun.spawn(cmd, { cwd: this.o.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    let tail = "";
    const run: Running = {
      proc, pending: new Map(), ready: undefined as unknown as Promise<void>, dead: false,
      started: false, timedOut: false, stderrTail: () => tail,
    };
    this.cur = run;
    let becameReady = false;
    run.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        run.timedOut = true;
        proc.kill();
        reject(new Error(`speech worker startup timed out after ${this.o.startupTimeoutMs ?? 120_000} ms`));
      }, this.o.startupTimeoutMs ?? 120_000);
      const stderrDone = (async () => {
        const dec = new TextDecoder();
        for await (const chunk of proc.stderr) {
          const t = dec.decode(chunk);
          tail = (tail + t).slice(-2000);
          if (tail.includes(STARTED_MARKER)) run.started = true;
          process.stderr.write(t);
        }
      })().catch(() => {});
      void (async () => {
        const dec = new TextDecoder();
        let buf = "";
        for await (const chunk of proc.stdout) {
          buf += dec.decode(chunk, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            let msg: any;
            try { msg = JSON.parse(line); } catch { continue; }
            if (typeof msg !== "object" || msg === null) continue;
            if (msg.ready) { becameReady = true; clearTimeout(timer); resolve(); continue; }
            const p = run.pending.get(msg.id);
            if (!p) continue;
            run.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg);
          }
        }
      })().catch(() => {});
      void proc.exited.then(async (code) => {
        await stderrDone;
        clearTimeout(timer);
        run.dead = true;
        const err = new Error(`speech worker exited (${code}): ${tail.trim().split("\n").slice(-3).join(" | ")}`);
        for (const p of run.pending.values()) p.reject(err);
        run.pending.clear();
        if (!becameReady) reject(err);
      });
    });
    try {
      await run.ready;
      this.failures = 0;
    } catch (e) {
      if (this.stopped) throw e;
      // Only a process that died before printing the marker means systemd-run itself failed.
      if (useSystemd && !run.started && !run.timedOut) {
        console.warn("speech worker: systemd-run failed before the worker started, launching without a memory cap");
        this.warned = true;
        return this.spawn(true);
      }
      proc.kill();
      this.failures++;
      this.lastFailAt = this.now();
      this.lastTail = tail.trim().split("\n").slice(-3).join(" | ") || String((e as Error).message);
      throw e;
    }
  }

  private call(req: Record<string, unknown>): Promise<any> {
    const run = this.chain.then(() => this.send(req));
    this.chain = run.catch(() => {});
    return run;
  }

  private async send(req: Record<string, unknown>): Promise<any> {
    if (this.stopped) throw new Error("speech worker stopped");
    if (!this.cur || this.cur.dead) await this.spawn(); // restart on the next call
    const c = this.cur!;
    await c.ready;
    const id = this.nextId++;
    const limit = this.o.requestTimeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        c.pending.delete(id);
        reject(new Error(`speech worker request timed out after ${limit} ms`));
        c.dead = true;
        c.proc.kill();
      }, limit);
      c.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        c.proc.stdin.write(JSON.stringify({ id, ...req }) + "\n");
        c.proc.stdin.flush();
      } catch (e) {
        clearTimeout(timer);
        c.pending.delete(id);
        reject(e as Error);
      }
    });
  }
}
