// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
//
// Frames in, whole utterances out. The ear takes 48 kHz mono Int16 frames from
// the phone, finds the end of a turn on an RMS energy level and a pause, and
// notices the owner talking over the voice (barge-in). Utterances go out as
// 16 kHz mono Int16.
import { downsample48kTo16k, level } from "./audio.js";

export interface EarSettings {
  /** the quiet after speech that ends a turn */
  endOfTurnPauseMs: number;
  /**
   * Kept for parity with the original ear. In this port the ear only emits
   * `onUtterance` at the end of turn; the early-transcription optimisation is
   * not implemented, so this value is unused.
   */
  earlyTranscribeMs: number;
  /** the louder level (fraction of full scale) that counts toward a barge-in */
  bargeInLevel: number;
  /** how long that level must be held */
  bargeInMs: number;
  /** how long a dip between syllables may last without resetting the count */
  bargeInGapMs: number;
  /** an utterance whose loudest frame is under this is too quiet to be a person and is dropped */
  minSpeechPeak: number;
  /** the level that counts as speech */
  speechLevel: number;
  /** how long the level must stay up before this counts as speech */
  speechMs: number;
  /** a recording this long is ended and delivered, so a room that never goes quiet cannot grow the buffer for ever */
  maxUtteranceMs: number;
  /** speech while the voice is speaking triggers a barge-in */
  interruptOnSpeech: boolean;
}

export const DEFAULT_EAR_SETTINGS: EarSettings = {
  endOfTurnPauseMs: 1500,
  earlyTranscribeMs: 400,
  bargeInLevel: 0.05,
  bargeInMs: 400,
  bargeInGapMs: 200,
  minSpeechPeak: 0.15,
  speechLevel: 0.02,
  speechMs: 50,
  maxUtteranceMs: 30_000,
  interruptOnSpeech: true,
};

export type EarOptions = EarSettings & {
  onUtterance: (pcm16k: Int16Array) => void;
  onSpeechStart: () => void;
  onBargeIn: () => void;
};

const RATE = 16_000;

export class Ear {
  private recording: Int16Array[] = [];
  private preRoll: Int16Array[] = [];
  private preRollSamples = 0;
  private recordingOpen = false;
  private loudMs = 0;
  private quietMs = 0;
  private peak = 0;
  private recordedMs = 0;
  private bargeMs = 0;
  private bargeQuietMs = 0;
  private barged = false;
  private carry = new Int16Array(0);
  private isSpeaking = false;

  constructor(private readonly o: EarOptions) {}

  /** The mouth sets this while it plays; a barge-in is only possible then. */
  set speaking(on: boolean) {
    if (on && !this.isSpeaking) {
      // a fresh playback gets a fresh count, so earlier talking does not barge in at once
      this.barged = false;
      this.bargeMs = 0;
      this.bargeQuietMs = 0;
    }
    this.isSpeaking = on;
  }
  get speaking(): boolean {
    return this.isSpeaking;
  }

  /** One frame of 48 kHz mono Int16 from the phone. */
  push(frame48k: Int16Array): void {
    const joined = new Int16Array(this.carry.length + frame48k.length);
    joined.set(this.carry);
    joined.set(frame48k, this.carry.length);
    const usable = joined.length - (joined.length % 3);
    this.carry = joined.slice(usable);
    if (usable === 0) return;
    const frame = downsample48kTo16k(joined.subarray(0, usable));
    this.frame(frame);
  }

  /** Drop anything half recorded (the phone cut its microphone). */
  reset(): void {
    this.recording = [];
    this.preRoll = [];
    this.preRollSamples = 0;
    this.recordingOpen = false;
    this.loudMs = 0;
    this.quietMs = 0;
    this.peak = 0;
    this.recordedMs = 0;
    this.bargeMs = 0;
    this.bargeQuietMs = 0;
    this.barged = false;
    this.carry = new Int16Array(0);
  }

  private frame(frame: Int16Array): void {
    const o = this.o;
    const ms = (frame.length / RATE) * 1000;
    const heard = level(frame);
    const loud = heard >= o.speechLevel;

    // The barge-in runs alongside the recording and never gates it: the
    // recording must start on a quiet first syllable, but playback must not
    // stop until the sound is loud enough, for long enough, to be a person.
    if (this.isSpeaking && o.interruptOnSpeech && !this.barged) {
      if (heard >= o.bargeInLevel) {
        this.bargeMs += ms;
        this.bargeQuietMs = 0;
      } else {
        this.bargeQuietMs += ms;
        if (this.bargeQuietMs >= o.bargeInGapMs) this.bargeMs = 0;
      }
      if (this.bargeMs >= o.bargeInMs) {
        this.barged = true;
        o.onBargeIn();
      }
    }

    if (!this.recordingOpen) {
      // keep a little of what came before, so the first word survives the decision
      this.preRoll.push(frame);
      this.preRollSamples += frame.length;
      const limit = Math.round(((o.speechMs + 200) * RATE) / 1000);
      while (this.preRollSamples > limit && this.preRoll.length > 1) {
        this.preRollSamples -= this.preRoll.shift()!.length;
      }
      this.loudMs = loud ? this.loudMs + ms : 0;
      if (this.loudMs < o.speechMs) return;
      this.recordingOpen = true;
      this.recording = [...this.preRoll];
      this.preRoll = [];
      this.preRollSamples = 0;
      this.quietMs = 0;
      this.peak = heard;
      this.recordedMs = (this.recording.reduce((n, b) => n + b.length, 0) / RATE) * 1000;
      o.onSpeechStart();
      return;
    }

    this.recording.push(frame);
    this.peak = Math.max(this.peak, heard);
    this.recordedMs += ms;
    this.quietMs = loud ? 0 : this.quietMs + ms;
    if (this.quietMs < o.endOfTurnPauseMs && this.recordedMs < o.maxUtteranceMs) return;
    this.finish();
  }

  private finish(): void {
    const blocks = this.recording;
    const peak = this.peak;
    this.recording = [];
    this.recordingOpen = false;
    this.loudMs = 0;
    this.quietMs = 0;
    this.peak = 0;
    this.recordedMs = 0;
    this.barged = false;
    this.bargeMs = 0;
    this.bargeQuietMs = 0;
    // under the minimum peak this was noise, not a person
    if (peak < this.o.minSpeechPeak) return;
    let total = 0;
    for (const b of blocks) total += b.length;
    const pcm = new Int16Array(total);
    let at = 0;
    for (const b of blocks) { pcm.set(b, at); at += b.length; }
    this.o.onUtterance(pcm);
  }
}
