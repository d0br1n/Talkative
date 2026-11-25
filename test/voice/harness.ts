// Fakes for the voice conversation: no audio device, no models, no network.
import type { AgentToVoice, VoiceToAgent } from "../../src/shared/link.js";
import type { ToPhone } from "../../src/shared/phone.js";
import { VoiceConversation, type VoiceConversationOptions } from "../../src/voice/conversation.js";

export const FRAME_MS = 20;
const FRAME_SAMPLES = 48 * FRAME_MS;

/** A 200 Hz sine at the given RMS level (fraction of full scale), 48 kHz, 20 ms. */
export function tone(rms = 0.3): Int16Array {
  const out = new Int16Array(FRAME_SAMPLES);
  const amp = rms * Math.SQRT2 * 32768;
  for (let i = 0; i < out.length; i++) out[i] = Math.round(amp * Math.sin((2 * Math.PI * 200 * i) / 48000));
  return out;
}
export const silence = () => new Int16Array(FRAME_SAMPLES);

/** Hands out scripted transcripts in order. */
export class FakeStt {
  texts: string[] = [];
  calls = 0;
  transcribe(_pcm16k: Int16Array): Promise<string> {
    this.calls++;
    return Promise.resolve(this.texts.shift() ?? "");
  }
}

/** Each synthesised clip carries the index of its text in sample 0, so plays can be read back as text. */
export class FakeTts {
  synthed: string[] = [];
  synth(text: string): Promise<Int16Array> {
    this.synthed.push(text);
    return Promise.resolve(new Int16Array([this.synthed.length - 1, 0, 0]));
  }
  textOf(pcm: Int16Array): string {
    return this.synthed[pcm[0]!]!;
  }
}

/** Plays at once, or holds each clip until `finish()` (or `stop()`) when `auto` is false. */
export class FakeSpeaker {
  played: Int16Array[] = [];
  stops = 0;
  auto = true;
  private current: (() => void) | null = null;
  play(pcm48k: Int16Array): Promise<void> {
    this.played.push(pcm48k);
    if (this.auto) return Promise.resolve();
    return new Promise((resolve) => (this.current = resolve));
  }
  stop(): void {
    this.stops++;
    this.finish();
  }
  finish(): void {
    const done = this.current;
    this.current = null;
    done?.();
  }
}

export class FakeAgent {
  sent: VoiceToAgent[] = [];
  up = true;
  send(m: VoiceToAgent): boolean {
    if (!this.up) return false;
    this.sent.push(m);
    return true;
  }
  of<T extends VoiceToAgent["t"]>(t: T): Extract<VoiceToAgent, { t: T }>[] {
    return this.sent.filter((m) => m.t === t) as any;
  }
}

/** The phone messages whose `t` can be T (blockStart and blockEnd share one member). */
type PhoneMsg<T> = ToPhone extends infer M ? (M extends { t: infer U } ? (T extends U ? M : never) : never) : never;

export class FakePhone {
  got: ToPhone[] = [];
  send(m: ToPhone): void {
    this.got.push(m);
  }
  of<T extends ToPhone["t"]>(t: T): PhoneMsg<T>[] {
    return this.got.filter((m) => m.t === t) as any;
  }
  last<T extends ToPhone["t"]>(t: T): PhoneMsg<T> | undefined {
    return this.of(t).at(-1);
  }
}

/** Let promise chains (STT, synthesis, playback) run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

export function rig(o: { connected?: boolean } & Partial<VoiceConversationOptions> = {}) {
  const stt = new FakeStt();
  const tts = new FakeTts();
  const speaker = new FakeSpeaker();
  const agent = new FakeAgent();
  const phone = new FakePhone();
  const conv = new VoiceConversation({
    stt, tts, speaker, agent, phone,
    now: () => 1_000,
    model: "sonnet",
    effort: "default",
    ...o,
    ear: { endOfTurnPauseMs: 300, ...o.ear },
  });
  if (o.connected ?? true) {
    conv.onAgentConnection(true);
    // what connectAgent sends on every welcome: the agent's state
    conv.onAgent({ t: "agent", state: "ready" });
  }
  const feed = (frame: () => Int16Array, ms: number) => {
    for (let t = 0; t < ms; t += FRAME_MS) conv.onFrame(frame());
  };
  /** Start talking: the ear opens a recording and stays mid-utterance. */
  const talk = (ms = 200) => feed(() => tone(0.3), ms);
  /** The pause that ends the utterance. */
  const pause = () => feed(silence, 400);
  /** One whole utterance that STT hears as `text`. */
  const utter = async (text: string) => {
    stt.texts.push(text);
    talk(600);
    pause();
    await settle();
  };
  const agentSays = (...ms: AgentToVoice[]) => { for (const m of ms) conv.onAgent(m); };
  /** A whole reply: turnStart, one delta per chunk, turnEnd. */
  const reply = (turnId: string, origin: "owner" | "agent", chunks: string[], end = true) => {
    agentSays({ t: "turnStart", turnId, origin });
    for (const text of chunks) agentSays({ t: "delta", turnId, block: 0, text });
    if (end) agentSays({ t: "turnEnd", turnId, ok: true });
  };
  const spoken = () => speaker.played.map((p) => tts.textOf(p));
  return { conv, stt, tts, speaker, agent, phone, feed, talk, pause, utter, agentSays, reply, spoken };
}
