import { describe, expect, test } from "bun:test";
import { Ear, DEFAULT_EAR_SETTINGS } from "../../src/voice/ear.js";
import { downsample48kTo16k, level } from "../../src/voice/audio.js";

const FRAME_MS = 20;
const FRAME_SAMPLES = 48 * FRAME_MS;

/** A 200 Hz sine at the given RMS level (fraction of full scale), 48 kHz, 20 ms. */
function tone(rms: number): Int16Array {
  const out = new Int16Array(FRAME_SAMPLES);
  const amp = rms * Math.SQRT2 * 32768;
  for (let i = 0; i < out.length; i++) out[i] = Math.round(amp * Math.sin((2 * Math.PI * 200 * i) / 48000));
  return out;
}
const silence = () => new Int16Array(FRAME_SAMPLES);

function rig(over: Partial<typeof DEFAULT_EAR_SETTINGS> = {}) {
  const events: string[] = [];
  const utterances: Int16Array[] = [];
  const ear = new Ear({
    ...DEFAULT_EAR_SETTINGS,
    ...over,
    onUtterance: (pcm) => { events.push("utterance"); utterances.push(pcm); },
    onSpeechStart: () => events.push("start"),
    onBargeIn: () => events.push("barge"),
  });
  const feed = (frame: () => Int16Array, ms: number) => { for (let t = 0; t < ms; t += FRAME_MS) ear.push(frame()); };
  return { ear, events, utterances, feed };
}

describe("defaults", () => {
  test("sidetone values", () => {
    expect(DEFAULT_EAR_SETTINGS).toMatchObject({
      endOfTurnPauseMs: 1500, earlyTranscribeMs: 400, bargeInLevel: 0.05, bargeInMs: 400, bargeInGapMs: 200,
      minSpeechPeak: 0.15, speechLevel: 0.02, speechMs: 50, interruptOnSpeech: true,
    });
  });
});

describe("audio helpers", () => {
  test("downsample averages groups of three", () => {
    expect(Array.from(downsample48kTo16k(Int16Array.from([3, 6, 9, 30, 30, 30])))).toEqual([6, 30]);
  });
  test("level of a sine", () => {
    expect(level(tone(0.3))).toBeCloseTo(0.3, 2);
    expect(level(new Int16Array(0))).toBe(0);
  });
});

describe("end of turn", () => {
  test("speech then the pause delivers one 16 kHz utterance", () => {
    const { events, utterances, feed } = rig();
    feed(() => tone(0.3), 1000);
    feed(silence, 1400);
    expect(events).toEqual(["start"]);
    feed(silence, 200);
    expect(events).toEqual(["start", "utterance"]);
    // about 1 s of speech plus 1.5 s of tail at 16 kHz, plus pre-roll
    expect(utterances[0]!.length).toBeGreaterThan(16000 * 2.4);
    expect(utterances[0]!.length).toBeLessThan(16000 * 2.8);
  });
  test("a short dip inside speech does not end the turn", () => {
    const { events, feed } = rig();
    feed(() => tone(0.3), 500);
    feed(silence, 1000);
    feed(() => tone(0.3), 500);
    feed(silence, 1600);
    expect(events.filter((e) => e === "utterance")).toHaveLength(1);
  });
  test("silence alone produces nothing", () => {
    const { events, feed } = rig();
    feed(silence, 5000);
    expect(events).toEqual([]);
  });
  test("an utterance whose peak is under minSpeechPeak is dropped", () => {
    const { events, feed } = rig();
    feed(() => tone(0.06), 600);
    feed(silence, 1700);
    expect(events).toEqual(["start"]);
  });
  test("a second turn is delivered after the first", () => {
    const { events, feed } = rig();
    for (let i = 0; i < 2; i++) { feed(() => tone(0.3), 600); feed(silence, 1700); }
    expect(events).toEqual(["start", "utterance", "start", "utterance"]);
  });
});

describe("barge-in", () => {
  test("400 ms of speech while the voice is speaking barges in once", () => {
    const { ear, events, feed } = rig();
    ear.speaking = true;
    feed(() => tone(0.3), 380);
    expect(events).not.toContain("barge");
    feed(() => tone(0.3), 60);
    expect(events.filter((e) => e === "barge")).toHaveLength(1);
    feed(() => tone(0.3), 1000);
    expect(events.filter((e) => e === "barge")).toHaveLength(1);
  });
  test("no barge-in when the voice is not speaking", () => {
    const { events, feed } = rig();
    feed(() => tone(0.3), 1000);
    expect(events).not.toContain("barge");
  });
  test("no barge-in when interruptOnSpeech is off", () => {
    const { ear, events, feed } = rig({ interruptOnSpeech: false });
    ear.speaking = true;
    feed(() => tone(0.3), 1000);
    expect(events).not.toContain("barge");
  });
  test("a lorry under bargeInLevel does not barge in", () => {
    const { ear, events, feed } = rig();
    ear.speaking = true;
    feed(() => tone(0.03), 1000);
    expect(events).not.toContain("barge");
  });
});

describe("barge-in dips", () => {
  const quiet = () => silence();
  test("a dip under bargeInGapMs keeps the count", () => {
    const { ear, events, feed } = rig();
    ear.speaking = true;
    feed(() => tone(0.3), 300);
    feed(quiet, 100);
    feed(() => tone(0.3), 100);
    expect(events.filter((e) => e === "barge")).toHaveLength(1);
  });
  test("a dip of bargeInGapMs or more resets the count", () => {
    const { ear, events, feed } = rig();
    ear.speaking = true;
    feed(() => tone(0.3), 300);
    feed(quiet, 200);
    feed(() => tone(0.3), 300);
    expect(events).not.toContain("barge");
    feed(() => tone(0.3), 100);
    expect(events.filter((e) => e === "barge")).toHaveLength(1);
  });
  test("speaking false then true re-arms the barge-in", () => {
    const { ear, events, feed } = rig();
    ear.speaking = true;
    feed(() => tone(0.3), 440);
    ear.speaking = false;
    ear.speaking = true;
    feed(() => tone(0.3), 440);
    expect(events.filter((e) => e === "barge")).toHaveLength(2);
  });
});

describe("reset, odd frame sizes and the length cap", () => {
  test("reset drops a half recorded utterance", () => {
    const { ear, events, feed } = rig();
    feed(() => tone(0.3), 600);
    ear.reset();
    feed(silence, 3000);
    expect(events).toEqual(["start"]);
  });
  test("frames not divisible by three keep every sample", () => {
    let pushed = 0;
    let pushedAtEnd = 0;
    const got: Int16Array[] = [];
    const ear = new Ear({
      ...DEFAULT_EAR_SETTINGS,
      onUtterance: (pcm) => { got.push(pcm); pushedAtEnd = pushed; },
      onSpeechStart: () => {},
      onBargeIn: () => {},
    });
    const one = tone(0.3);
    const chunk = (src: Int16Array) => { const f = src.subarray(0, 1000); pushed += f.length; ear.push(f); };
    for (let i = 0; i < 48; i++) chunk(one.length >= 1000 ? one : new Int16Array(1000).fill(8000));
    for (let i = 0; i < 80; i++) chunk(new Int16Array(1000));
    expect(got).toHaveLength(1);
    // all samples but the carried remainder (0-2) arrive at 1/3 the count
    expect(pushedAtEnd - got[0]!.length * 3).toBeLessThan(3);
    expect(pushedAtEnd - got[0]!.length * 3).toBeGreaterThanOrEqual(0);
  });
  test("a room that never goes quiet is cut at maxUtteranceMs and delivered", () => {
    const { events, utterances, feed } = rig({ maxUtteranceMs: 2000 });
    feed(() => tone(0.3), 2100);
    expect(events.filter((e) => e === "utterance")).toHaveLength(1);
    expect(utterances[0]!.length).toBeLessThanOrEqual(16000 * 2.1);
    expect(utterances[0]!.length).toBeGreaterThanOrEqual(16000 * 2);
  });
  test("a forced end is gated by minSpeechPeak like any other", () => {
    const { events, feed } = rig({ maxUtteranceMs: 2000 });
    feed(() => tone(0.06), 2500);
    expect(events.filter((e) => e === "utterance")).toHaveLength(0);
  });
  test("default maxUtteranceMs is 30 s", () => {
    expect(DEFAULT_EAR_SETTINGS.maxUtteranceMs).toBe(30000);
  });
});
