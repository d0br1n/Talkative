// Client for the Python speech worker (bench.worker): JSON lines over stdin/stdout.
import { existsSync } from "node:fs";

const OUT_RATE = 48000;

export interface SpeechWorkerOptions {
  python: string;
  stt: string;
  tts: string;
  memoryMaxMb?: number;
  cwd: string;
  /** Test hook: replaces `python -m bench.worker --stt .. --tts ..`. */
  command?: string[];
}

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
}

export class SpeechWorker {
  private cur: Running | null = null;
  private nextId = 1;
  private chain: Promise<unknown> = Promise.resolve();
  private warned = false;

  constructor(private o: SpeechWorkerOptions) {}

  async start(): Promise<void> {
    if (this.cur && !this.cur.dead) return this.cur.ready;
    await this.spawn(true);
  }

  stop(): void {
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

  private async spawn(allowFallback: boolean, direct = false): Promise<void> {
    const base = this.baseCommand();
    const useSystemd = !direct && this.o.memoryMaxMb !== undefined && existsSync("/usr/bin/systemd-run");
    if (this.o.memoryMaxMb !== undefined && !useSystemd && !this.warned) {
      this.warned = true;
      console.warn("speech worker: systemd-run unavailable, running without a memory cap");
    }
    const cmd = useSystemd
      ? ["systemd-run", "--user", "--scope", "-q", "-p", `MemoryMax=${this.o.memoryMaxMb}M`, ...base]
      : base;
    const proc = Bun.spawn(cmd, { cwd: this.o.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const run: Running = { proc, pending: new Map(), ready: undefined as unknown as Promise<void>, dead: false };
    this.cur = run;
    let becameReady = false;
    run.ready = new Promise<void>((resolve, reject) => {
      let stderrTail = "";
      void (async () => {
        const dec = new TextDecoder();
        for await (const chunk of proc.stderr) {
          const t = dec.decode(chunk);
          stderrTail = (stderrTail + t).slice(-2000);
          process.stderr.write(t);
        }
      })();
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
            if (msg.ready) { becameReady = true; resolve(); continue; }
            const p = run.pending.get(msg.id);
            if (!p) continue;
            run.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg);
          }
        }
      })();
      void proc.exited.then((code) => {
        run.dead = true;
        const err = new Error(`speech worker exited (${code}): ${stderrTail.trim().split("\n").slice(-3).join(" | ")}`);
        for (const p of run.pending.values()) p.reject(err);
        run.pending.clear();
        if (!becameReady) reject(err);
      });
    });
    try {
      await run.ready;
    } catch (e) {
      if (useSystemd && allowFallback) {
        console.warn("speech worker: systemd-run failed before ready, retrying without a memory cap");
        this.warned = true;
        return this.spawn(false, true);
      }
      throw e;
    }
  }

  private call(req: Record<string, unknown>): Promise<any> {
    const run = this.chain.then(() => this.send(req));
    this.chain = run.catch(() => {});
    return run;
  }

  private async send(req: Record<string, unknown>): Promise<any> {
    if (!this.cur || this.cur.dead) await this.spawn(true); // restart on the next call
    const c = this.cur!;
    await c.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      c.pending.set(id, { resolve, reject });
      try {
        c.proc.stdin.write(JSON.stringify({ id, ...req }) + "\n");
        c.proc.stdin.flush();
      } catch (e) {
        c.pending.delete(id);
        reject(e as Error);
      }
    });
  }
}
