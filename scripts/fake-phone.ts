#!/usr/bin/env bun
// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
//
// A phone, without the phone. It pairs the way the app does, joins the room as
// `phone`, plays WAV files into it as its microphone, and reports what comes
// back: the voice's audio and the phone-protocol messages.
//
//   bun scripts/fake-phone.ts --pair http://127.0.0.1:7890 --code "amber cedar tide" \
//     --say tests/fixtures/sentence.wav [--say more.wav] [--text "typed turn"] \
//     [--decide allow|deny|none] [--wait <seconds>]
//
// Each WAV is played as 48 kHz 20 ms frames in real time, followed by 2 s of
// silence; like a real phone's, the microphone sends silence whenever no WAV
// plays. A later WAV waits for the voice to start answering the one before
// it (up to 15 s), so a second WAV lands during the reply: that is a barge-in.
// `--text` sends a typed turn after the WAVs. `--decide` answers every approval.
// `--wait` is how long to keep listening after the last action (default 8 s).
//
// Output is one JSON line per event, `{event, t, ...}`, where t is seconds
// since the end of the utterance just played (or the typed turn just sent).
// Events: joined, played, said, heard, firstAudio, sentence, speaking, status,
// narration, approval, decide, approvalDone, error, and at the end lastAudio: `last` is
// when loud audio last arrived and `loudMs` how much arrived, both since the
// last utterance ended.
import {
  AudioFrame, AudioSource, AudioStream, dispose, LocalAudioTrack, Room, RoomEvent,
  TrackKind, TrackPublishOptions, TrackSource, type RemoteParticipant, type RemoteTrack,
} from "@livekit/rtc-node";
import { flag } from "../src/cli";
import { decodeToPhone, encodePhone, PHONE_PROTOCOL, type FromPhone } from "../src/shared/phone";

const RATE = 48_000;
const FRAME = RATE / 50; // 20 ms
const SILENCE_AFTER_MS = 2000;
/** an incoming sample louder than this is the voice talking, not codec noise */
const LOUD = 800;

const USAGE =
  "usage: bun scripts/fake-phone.ts --pair <http://host:7890> --code <words> --say <wav> [--say <wav> ...] " +
  "[--text <typed>] [--decide allow|deny|none] [--wait <seconds>]";

function all(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== `--${name}`) continue;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`--${name} needs a value`);
    out.push(v);
  }
  return out;
}

const args = process.argv.slice(2);
let pair, code, says: string[], text, decide: string, waitS: number;
try {
  pair = flag(args, "pair");
  code = flag(args, "code");
  says = all(args, "say");
  text = flag(args, "text");
  decide = flag(args, "decide") ?? "none";
  waitS = Number(flag(args, "wait") ?? 8);
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`);
  process.exit(2);
}
if (!pair || !code || (says.length === 0 && !text) || !["allow", "deny", "none"].includes(decide) || !(waitS >= 0)) {
  console.error(USAGE);
  process.exit(2);
}

/** Decode any WAV to 48 kHz mono Int16 with ffmpeg. */
async function load(path: string): Promise<Int16Array> {
  const p = Bun.spawn(["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", String(RATE), "-"], {
    stdout: "pipe", stderr: "pipe",
  });
  const [bytes, err, status] = await Promise.all([
    new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited,
  ]);
  if (status !== 0) throw new Error(`ffmpeg could not read ${path}: ${err.trim()}`);
  return new Int16Array(bytes.slice(0, bytes.byteLength - (bytes.byteLength % 2)));
}

const clips = await Promise.all(says.map(load));

// ---- events ----

/** the end of the utterance just played; t is measured from here */
let mark = performance.now();
let firstAudioSeen = false;
let lastLoud = 0;
let loudMsSinceMark = 0;
let firstAudio = Promise.withResolvers<void>();
/** the voice's first status: it has seen us join */
const greeted = Promise.withResolvers<void>();

function emit(event: string, fields: Record<string, unknown> = {}, at = performance.now()): void {
  console.log(JSON.stringify({ event, t: Number(((at - mark) / 1000).toFixed(3)), ...fields }));
}

function newMark(): void {
  mark = performance.now();
  firstAudioSeen = false;
  loudMsSinceMark = 0;
  firstAudio = Promise.withResolvers<void>();
}

// ---- pairing and the room ----

const res = await fetch(`${pair.replace(/\/$/, "")}/pair`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
});
if (!res.ok) {
  console.error(`fake-phone: pairing failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { url, token } = (await res.json()) as { url: string; token: string };

const room = new Room();
const send = (m: FromPhone) =>
  room.localParticipant?.publishData(new TextEncoder().encode(encodePhone(m)), { reliable: true })
    .catch((e) => console.error(`fake-phone: send failed: ${(e as Error).message}`));

room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
  let m;
  try {
    m = decodeToPhone(new TextDecoder().decode(payload));
  } catch (e) {
    return void console.error(`fake-phone: bad message: ${(e as Error).message}`);
  }
  switch (m.t) {
    case "heard": return emit("heard", { text: m.text });
    case "sentence": return emit("sentence", { turnId: m.turnId, index: m.index, text: m.text });
    case "speaking": return emit("speaking", { turnId: m.turnId, index: m.index });
    case "status":
      greeted.resolve();
      return emit("status", { agent: m.agent, thinking: m.thinking, jobs: m.jobs, audio: m.audio });
    case "error": return emit("error", { text: m.text });
    case "narration": return emit("narration", { text: m.text });
    case "approvalDone": return emit("approvalDone", { id: m.id, allow: m.allow, by: m.by });
    case "approval":
      emit("approval", { id: m.id, tool: m.tool, summary: m.summary, expiresAt: m.expiresAt });
      if (decide !== "none") {
        void send({ t: "decide", id: m.id, allow: decide === "allow" });
        emit("decide", { id: m.id, allow: decide === "allow" });
      }
      return;
  }
});

const listened = new Set<string>();
function listen(track: RemoteTrack): void {
  if (track.kind !== TrackKind.KIND_AUDIO) return;
  const sid = track.sid ?? String(listened.size);
  if (listened.has(sid)) return;
  listened.add(sid);
  void (async () => {
    for await (const frame of new AudioStream(track, { sampleRate: RATE, numChannels: 1 })) {
      let loud = false;
      for (const s of frame.data) if (s > LOUD || s < -LOUD) { loud = true; break; }
      if (!loud) continue;
      const now = performance.now();
      lastLoud = now;
      loudMsSinceMark += (frame.samplesPerChannel / RATE) * 1000;
      if (!firstAudioSeen) {
        firstAudioSeen = true;
        emit("firstAudio", {}, now);
        firstAudio.resolve();
      }
    }
  })().catch((e) => console.error(`fake-phone: audio stream ended: ${(e as Error).message}`));
}
room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: unknown, _p: RemoteParticipant) => listen(track));

let closing = false;
async function close(code: number): Promise<never> {
  if (!closing) {
    closing = true;
    try { await room.disconnect(); } catch {}
    try { await dispose(); } catch {}
  }
  process.exit(code);
}
process.on("SIGTERM", () => void close(0));
process.on("SIGINT", () => void close(0));

await room.connect(url, token, { autoSubscribe: true, dynacast: false });
for (const p of room.remoteParticipants.values()) {
  for (const pub of p.trackPublications.values()) if (pub.track) listen(pub.track as RemoteTrack);
}
const source = new AudioSource(RATE, 1);
const track = LocalAudioTrack.createAudioTrack("mic", source);
const options = new TrackPublishOptions();
options.source = TrackSource.SOURCE_MICROPHONE;
await room.localParticipant!.publishTrack(track, options);
await send({ t: "hello", protocol: PHONE_PROTOCOL });
newMark();
emit("joined", { room: room.name });

/**
 * The microphone: like a real phone's, it never stops sending. A frame of the
 * clip being played, or silence. Paced by the wall clock, 20 ms a frame.
 */
interface Clip { pcm: Int16Array; at: number; ended: () => void }
let clip = null as Clip | null;
void (async () => {
  const start = performance.now();
  for (let n = 0; !closing; n++) {
    const ahead = start + n * 20 - performance.now();
    if (ahead > 0) await Bun.sleep(ahead);
    const data = new Int16Array(FRAME);
    const c = clip;
    if (c) {
      data.set(c.pcm.subarray(c.at, c.at + FRAME));
      c.at += FRAME;
      if (c.at >= c.pcm.length) {
        clip = null;
        c.ended();
      }
    }
    try {
      await source.captureFrame(new AudioFrame(data, RATE, 1, FRAME));
    } catch (e) {
      if (!closing) console.error(`fake-phone: mic failed: ${(e as Error).message}`);
      return;
    }
  }
})();

/** Play one clip, then let 2 s of silence go out after it. */
async function play(pcm: Int16Array): Promise<void> {
  await new Promise<void>((ended) => (clip = { pcm, at: 0, ended }));
  newMark(); // the last frame of the clip went out: from here, t counts
  await Bun.sleep(SILENCE_AFTER_MS);
}

// anything said before the voice has seen us is lost: wait for its status, then a moment for it to subscribe
const seen = await Promise.race([greeted.promise.then(() => true), Bun.sleep(10_000).then(() => false)]);
if (!seen) console.error("fake-phone: no status from the voice after 10 s; playing anyway");
await Bun.sleep(300);

for (const [i, pcm] of clips.entries()) {
  if (i > 0) {
    // a later clip is a barge-in: it waits for the voice to start answering
    await Promise.race([firstAudio.promise, Bun.sleep(15_000)]);
  }
  await play(pcm);
  emit("played", { file: says[i], seconds: Number((pcm.length / RATE).toFixed(2)) });
}
if (text) {
  await send({ t: "said", text });
  newMark();
  emit("said", { text });
}

await Bun.sleep(waitS * 1000);
emit("lastAudio", { last: lastLoud ? Number(((lastLoud - mark) / 1000).toFixed(3)) : null, loudMs: Math.round(loudMsSinceMark) });
await close(0);
