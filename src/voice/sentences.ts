// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.

/**
 * Collect the streamed words to the end of a sentence.
 *
 * The point is latency: one sentence is spoken while the model still writes
 * the next, so the time to the first audio is the time to the first
 * sentence, not the time to the whole reply.
 *
 * Splitting too eagerly costs a small pause. Splitting too late holds the
 * audio back. This errs toward splitting, and never waits for punctuation
 * that may not arrive.
 *
 * Contract with speakable(): a fenced code block (opening \`\`\` or ~~~ line
 * through its matching closing fence) comes out as ONE unit, when the fence
 * closes (or from flush() if it never does), and a run of consecutive table
 * rows (lines starting with "|") comes out as one unit, once a non-table line
 * arrives (or from flush()). Callers apply speakable() to each output unit.
 */
const FENCE = /^\s*(```|~~~)/;
const ABBREVIATION = /(^|[^\p{L}])(e\.g|i\.e|etc|vs|dr|mr|mrs|ms|st|approx|incl)\.$/iu;
const CLOSERS = `.!?"')]`;

export class SentenceCollector {
  private buffer = "";

  constructor(private readonly maxChars = 240) {}

  /** The complete sentences this text finishes. The rest waits for more. */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    for (;;) {
      const at = this.block() ?? this.boundary();
      if (at < 0) break;
      const sentence = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at);
      if (sentence) out.push(sentence);
    }
    // a long run with no punctuation at all must not hold the audio back
    while (this.buffer.length > this.maxChars && !this.pendingBlock()) {
      const space = this.buffer.lastIndexOf(" ", this.maxChars);
      const at = space > 0 ? space : this.maxChars;
      const chunk = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at);
      if (chunk) out.push(chunk);
    }
    return out;
  }

  /** The reply ended, so whatever is left is a sentence whether it looks like one or not. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }

  /** Whether the buffer starts a fenced block or table that is not complete yet. */
  private pendingBlock(): boolean {
    return FENCE.test(this.buffer) || /^\s*\|/.test(this.buffer);
  }

  /**
   * The end of a leading fenced block or table run: an index when it is
   * complete, -1 while it waits, null when the buffer does not start one.
   */
  private block(): number | null {
    const lead = this.buffer.length - this.buffer.trimStart().length;
    const text = this.buffer.slice(lead);
    if (FENCE.test(text)) {
      const open = text.indexOf("\n");
      if (open < 0) return -1;
      const marker = FENCE.exec(text)![1]!;
      let at = open + 1;
      while (at < text.length) {
        const eol = text.indexOf("\n", at);
        if (eol < 0) return -1;
        if (text.slice(at, eol).trimStart().startsWith(marker)) return lead + eol + 1;
        at = eol + 1;
      }
      return -1;
    }
    if (text.startsWith("|")) {
      let at = 0;
      for (;;) {
        const eol = text.indexOf("\n", at);
        const line = text.slice(at, eol < 0 ? undefined : eol);
        if (eol < 0) return line.trim() === "" || line.startsWith("|") ? -1 : lead + at;
        if (!line.trimStart().startsWith("|")) return lead + at;
        at = eol + 1;
      }
    }
    return null;
  }

  /** Whether the text after a newline starts a fence or a table row (or may yet). */
  private startsBlock(rest: string): boolean {
    const t = rest.trimStart();
    return t.startsWith("|") || FENCE.test(t) || (t.length > 0 && t.length < 3 && ("```".startsWith(t) || "~~~".startsWith(t)));
  }

  /** The index one past the end of the first sentence, or -1 while it is not certain. */
  private boundary(): number {
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i] as string;
      if (ch === "\n") {
        // a fence or a table starts a unit of its own, however short the text before it
        if (short(this.buffer.slice(0, i)) && !this.startsBlock(this.buffer.slice(i + 1))) continue;
        return i + 1;
      }
      if (ch !== "." && ch !== "!" && ch !== "?") continue;
      // 3.5 and 1.2.3 are numbers, not the ends of sentences
      if (ch === "." && /\d/.test(this.buffer[i - 1] ?? "") && /\d/.test(this.buffer[i + 1] ?? "")) continue;
      if (ch === "." && ABBREVIATION.test(this.buffer.slice(0, i + 1))) continue;
      let j = i + 1;
      while (j < this.buffer.length && CLOSERS.includes(this.buffer[j] as string)) j++;
      // the punctuation is the last thing here: more text may still make it a number or an ellipsis
      if (j >= this.buffer.length) return -1;
      // a full stop inside a quotation does not end the sentence that quotes it
      if (quoteOpen(this.buffer.slice(0, j)) || short(this.buffer.slice(0, j))) continue;
      if (/\s/.test(this.buffer[j] as string)) return j;
    }
    return -1;
  }
}

/**
 * a sentence of one or two words is not a clip of its own: it joins the
 * sentence after it, because a voice engine garbles such a clip alone.
 */
function short(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length < 3;
}

/**
 * Whether a double quotation is still open at the end of this text, so a full
 * stop inside a quotation does not cut the sentence that quotes it.
 */
function quoteOpen(text: string): boolean {
  return text.split('"').length % 2 === 0;
}
