import { appendFileSync, chmodSync, renameSync, statSync } from "node:fs";

export interface PhoneLogOptions {
  path: string;
  now?: () => number;
  maxLineBytes?: number;
  maxFileBytes?: number;
  perSecond?: number;
}

const ELLIPSIS = Buffer.from("…");

/**
 * Append-only log of what the phone says. The text is hostile: it is escaped onto
 * one line, cut, rate-limited and rotated, and a failed write never throws.
 */
export class PhoneLog {
  private readonly path: string;
  private readonly now: () => number;
  private readonly maxLine: number;
  private readonly maxFile: number;
  private readonly perSecond: number;
  private second = -1;
  private inSecond = 0;
  private dropped = 0;
  private lastError = -Infinity;

  constructor(o: PhoneLogOptions) {
    this.path = o.path;
    this.now = o.now ?? Date.now;
    this.maxLine = o.maxLineBytes ?? 2048;
    this.maxFile = o.maxFileBytes ?? 5_000_000;
    this.perSecond = o.perSecond ?? 20;
  }

  write(level: "info" | "error", text: string): void {
    try {
      const t = this.now();
      const sec = Math.floor(t / 1000);
      if (sec !== this.second) {
        this.second = sec;
        this.inSecond = 0;
        if (this.dropped > 0) {
          const n = this.dropped;
          this.dropped = 0;
          this.append(this.line(t, "info", `… dropped ${n} lines`));
        }
      }
      if (this.inSecond >= this.perSecond) {
        this.dropped++;
        return;
      }
      this.inSecond++;
      this.append(this.line(t, level, escape(text)));
    } catch (e) {
      this.fail(e);
    }
  }

  private line(t: number, level: string, text: string): Buffer {
    const full = Buffer.from(`${new Date(t).toISOString()} ${level} ${text}`);
    const room = this.maxLine - 1; // the newline counts
    if (full.length <= room) return Buffer.concat([full, Buffer.from("\n")]);
    let end = Math.max(0, room - ELLIPSIS.length);
    while (end > 0 && (full[end]! & 0xc0) === 0x80) end--; // not inside a character
    return Buffer.concat([full.subarray(0, end), ELLIPSIS, Buffer.from("\n")]);
  }

  private append(line: Buffer): void {
    let size = 0;
    try {
      size = statSync(this.path).size;
    } catch {
      // not there yet
    }
    if (size > 0 && size + line.length > this.maxFile) {
      renameSync(this.path, `${this.path}.1`);
      size = 0;
    }
    appendFileSync(this.path, line, { mode: 0o600 });
    if (size === 0) chmodSync(this.path, 0o600);
  }

  private fail(e: unknown): void {
    const t = this.now();
    if (t - this.lastError < 60_000) return;
    this.lastError = t;
    try {
      console.error(`voice: cannot write the phone log ${this.path}: ${e instanceof Error ? e.message : String(e)}`);
    } catch {
      // nothing more to do
    }
  }
}

function escape(text: string): string {
  return text.replace(/[\\\x00-\x1f]/g, (c) => {
    if (c === "\\") return "\\\\";
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    return "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0");
  });
}
