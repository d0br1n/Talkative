// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
//
// What the voice says, from a sentence to the sound of it. One queue of
// sentences, played in order and never overlapping. The engine takes one
// request at a time, so the next sentence is made once the current one is
// made, while it plays: the gap between sentences is the playback, not the
// synthesis. A stop drops the whole queue, not just the sentence in flight:
// cutting only the one playing lets the queue drain into the gap, and the
// voice keeps talking a sentence at a time.
import type { ToPhone } from "../shared/phone.js";

/** The part that plays one sound. The room and a test differ only here. */
export interface Speaker {
  /** Play one clip of 48 kHz mono Int16. Resolves when it ends or `stop()` cuts it. */
  play(pcm48k: Int16Array): Promise<void>;
  stop(): void;
}

export interface Tts {
  synth(text: string): Promise<Int16Array>;
}

export interface PhonePort {
  send(m: ToPhone): void;
}

export interface MouthOptions {
  tts: Tts;
  speaker: Speaker;
  phone: PhonePort;
  /** True from the first sentence played until the queue runs dry or is stopped; the ear's barge-in watches it. */
  onSpeaking?: (on: boolean) => void;
}

interface Queued {
  turnId: string;
  index: number;
  text: string;
  /** null when synthesis failed: the sentence is skipped */
  pcm: Promise<Int16Array | null> | null;
}

export class Mouth {
  private queue: Queued[] = [];
  private pumping = false;
  private playing = false;
  /** a sentence taken off the queue and not yet finished, in this generation */
  private active = false;
  private speaking = false;
  /** bumped by every stop, so a sentence made or played before it is not carried on after */
  private generation = 0;

  constructor(private readonly o: MouthOptions) {}

  /** Queue one sentence of a reply. */
  say(turnId: string, index: number, text: string): void {
    this.queue.push({ turnId, index, text, pcm: null });
    // a sentence is playing, so this one may be made now, ahead of its turn
    if (this.playing) this.prefetch();
    void this.pump();
  }

  /** Stop at once: the sentence playing and everything queued behind it. */
  stop(): void {
    this.generation++;
    this.queue = [];
    this.active = false;
    this.o.speaker.stop();
    this.setSpeaking(false);
  }

  /** Whether anything is queued, being made, or playing. */
  get busy(): boolean {
    return this.active || this.queue.length > 0;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let next = this.queue.shift(); next; next = this.queue.shift()) {
        const generation = this.generation;
        this.active = true;
        const pcm = await this.made(next);
        if (generation !== this.generation || !pcm) continue;
        this.prefetch();
        this.playing = true;
        this.setSpeaking(true);
        this.o.phone.send({ t: "speaking", turnId: next.turnId, index: next.index });
        try {
          await this.o.speaker.play(pcm);
        } catch {
          // a transport that dropped is not this loop's problem
        } finally {
          this.playing = false;
        }
      }
    } finally {
      this.pumping = false;
      this.active = false;
      this.setSpeaking(false);
    }
  }

  private made(q: Queued): Promise<Int16Array | null> {
    return (q.pcm ??= this.o.tts.synth(q.text).catch(() => null));
  }

  private prefetch(): void {
    const next = this.queue[0];
    if (next) void this.made(next);
  }

  private setSpeaking(on: boolean): void {
    if (on === this.speaking) return;
    this.speaking = on;
    this.o.onSpeaking?.(on);
  }
}
