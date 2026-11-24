// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
//
// The voice's end of the LiveKit room: the phone's microphone in, one audio
// track out, and the reliable data channel for the phone protocol. Echo
// cancellation is the phone's job; nothing here guesses at it.
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room as LkRoom, RoomEvent,
  TrackKind, TrackPublishOptions, TrackSource, type RemoteParticipant, type RemoteTrack,
} from "@livekit/rtc-node";
import { decodeFromPhone, encodePhone, type FromPhone, type ToPhone } from "../shared/phone";
import type { PhonePort, Speaker } from "./mouth";

/** The part of the SDK's Room this file uses; a test gives its own. */
export type LkRoomLike = Pick<LkRoom, "on" | "connect" | "disconnect" | "remoteParticipants" | "localParticipant">;

const RATE = 48_000;
const FRAME = (RATE * 20) / 1000;
const PHONE = "phone";

export class Room {
  private readonly room: LkRoomLike;
  private lostCb: () => void = () => {};
  private sourceInst: AudioSource | null = null;
  private get source(): AudioSource {
    return (this.sourceInst ??= new AudioSource(RATE, 1));
  }
  private frameCb: (f: Int16Array) => void = () => {};
  private phoneCb: (m: FromPhone) => void = () => {};
  private goneCb: () => void = () => {};
  private joinedCb: () => void = () => {};
  /** the phone's audio track sids, oldest first; the newest feeds the ear */
  private tracks: string[] = [];
  private closed = false;
  private joined = false;
  private sending: Promise<void> = Promise.resolve();
  private cur: { cancelled: boolean; done: () => void } | null = null;

  /** `token` is called on every join attempt, so a retry never reuses an old token. `lk` is a test seam. */
  constructor(private readonly o: { url: string; token: () => Promise<string>; lk?: LkRoomLike }) {
    this.room = o.lk ?? (new LkRoom() as unknown as LkRoomLike);
    this.register();
  }

  /** The SDK gave up on the connection (it has already retried). */
  onLost(cb: () => void): void {
    this.lostCb = cb;
  }

  onFrame(cb: (frame48k: Int16Array) => void): void {
    this.frameCb = cb;
  }
  onPhone(cb: (m: FromPhone) => void): void {
    this.phoneCb = cb;
  }
  /**
   * The phone is in the room. Its first data message can arrive before the SDK
   * knows who sent it, and is then dropped, so this, not the phone's `hello`,
   * is the dependable moment to bring it up to date.
   */
  onPhoneJoined(cb: () => void): void {
    this.joinedCb = cb;
  }

  /** The phone left, or its audio track went away. */
  onPhoneGone(cb: () => void): void {
    this.goneCb = cb;
  }

  readonly speaker: Speaker = {
    play: async (pcm) => {
      this.cancel();
      let done!: () => void;
      const ended = new Promise<void>((r) => (done = r));
      const mine = { cancelled: false, done };
      this.cur = mine;
      try {
        for (let at = 0; at < pcm.length && !mine.cancelled; at += FRAME) {
          const data = new Int16Array(FRAME);
          data.set(pcm.subarray(at, at + FRAME));
          await this.source.captureFrame(new AudioFrame(data, RATE, 1, FRAME));
        }
        if (!mine.cancelled) await Promise.race([this.source.waitForPlayout(), ended]);
      } catch (e) {
        if (!mine.cancelled) console.error(`voice: playback failed: ${(e as Error).message}`);
      } finally {
        if (this.cur === mine) this.cur = null;
      }
    },
    stop: () => this.cancel(),
  };

  /** Barge-in: drop what is queued in the source and end the clip in flight. */
  private cancel(): void {
    const c = this.cur;
    this.cur = null;
    if (c) {
      c.cancelled = true;
      c.done();
    }
    try {
      this.source.clearQueue();
    } catch {}
  }

  readonly phone: PhonePort = {
    send: (m: ToPhone) => {
      let payload: Uint8Array;
      try {
        payload = new TextEncoder().encode(encodePhone(m));
      } catch (e) {
        return void console.error(`voice: not sending to phone: ${(e as Error).message}`);
      }
      const lp = this.room.localParticipant;
      if (!lp || this.closed) return;
      this.sending = this.sending
        .then(() => lp.publishData(payload, { reliable: true }))
        .catch((e) => console.error(`voice: phone send failed: ${(e as Error).message}`));
    },
  };

  /** Join the room, retrying while LiveKit is still coming up (up to `deadlineMs`). */
  async join(deadlineMs = 60_000): Promise<void> {
    const until = Date.now() + deadlineMs;
    for (let wait = 500; ; wait = Math.min(wait * 2, 5000)) {
      try {
        await this.connect();
        this.joined = true;
        return;
      } catch (e) {
        if (Date.now() + wait >= until) throw e;
        console.error(`voice: waiting for livekit at ${this.o.url}: ${(e as Error).message}`);
        await Bun.sleep(wait);
      }
    }
  }

  /** Handlers go on once, here: a retried connect() must not add them again. */
  private register(): void {
    const r = this.room;
    r.on(RoomEvent.DataReceived, (payload: Uint8Array, p?: RemoteParticipant) => {
      if (p?.identity !== PHONE) return;
      let m: FromPhone;
      try {
        m = decodeFromPhone(new TextDecoder().decode(payload));
      } catch (e) {
        return void console.error(`voice: dropped a malformed phone message: ${(e as Error).message}`);
      }
      this.phoneCb(m);
    });
    r.on(RoomEvent.TrackSubscribed, (t: RemoteTrack, _pub: unknown, p: RemoteParticipant) => {
      if (p.identity === PHONE) this.pump(t);
    });
    r.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack, _pub: unknown, p: RemoteParticipant) => {
      if (p.identity !== PHONE || t.kind !== TrackKind.KIND_AUDIO) return;
      this.tracks = this.tracks.filter((s) => s !== t.sid);
      if (this.tracks.length === 0) this.goneCb();
    });
    r.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      if (p.identity === PHONE) this.joinedCb();
    });
    r.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      if (p.identity !== PHONE) return;
      this.tracks = [];
      this.goneCb();
    });
    r.on(RoomEvent.Disconnected, () => {
      if (this.joined && !this.closed) this.lostCb();
    });
  }

  private async connect(): Promise<void> {
    const r = this.room;
    await r.connect(this.o.url, await this.o.token(), { autoSubscribe: true, dynacast: false });
    // a phone that was in the room first never fires the events above
    for (const p of r.remoteParticipants.values()) {
      if (p.identity !== PHONE) continue;
      this.joinedCb();
      for (const pub of p.trackPublications.values()) if (pub.track) this.pump(pub.track as RemoteTrack);
    }
    const lp = r.localParticipant;
    if (!lp) return;
    const track = LocalAudioTrack.createAudioTrack("voice", this.source);
    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE;
    await lp.publishTrack(track, options);
  }

  /** One track feeds the ear: the newest. An older one stays subscribed and its frames are dropped. */
  private pump(track: RemoteTrack): void {
    if (track.kind !== TrackKind.KIND_AUDIO) return;
    const sid = track.sid ?? `t${this.tracks.length}`;
    if (this.tracks.includes(sid)) return;
    this.tracks.push(sid);
    void (async () => {
      for await (const frame of new AudioStream(track, { sampleRate: RATE, numChannels: 1 })) {
        if (this.closed) return;
        if (this.tracks.at(-1) !== sid) continue;
        this.frameCb(new Int16Array(frame.data.buffer, frame.data.byteOffset, frame.data.length));
      }
    })().catch((e) => console.error(`voice: audio stream ended: ${(e as Error).message}`));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.cancel();
    await this.room.disconnect();
  }
}
