import { expect, test } from "bun:test";
import { RoomEvent } from "@livekit/rtc-node";
import { encodePhone } from "../../src/shared/phone";
import { Room, type LkRoomLike } from "../../src/voice/room";

class FakeLk {
  handlers = new Map<string, ((...a: any[]) => void)[]>();
  attempts = 0;
  tokens: string[] = [];
  remoteParticipants = new Map();
  localParticipant = undefined;
  constructor(private failures: number) {}
  on(ev: string, cb: (...a: any[]) => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb]);
    return this;
  }
  async connect(_url: string, token: string) {
    this.attempts++;
    this.tokens.push(token);
    if (this.attempts <= this.failures) throw new Error("not yet");
  }
  async disconnect() {}
  emit(ev: string, ...a: any[]) {
    for (const h of this.handlers.get(ev) ?? []) h(...a);
  }
}

test("handlers are registered once; retries mint a fresh token each time; one dispatch per data event", async () => {
  const lk = new FakeLk(2);
  let n = 0;
  const room = new Room({ url: "ws://x", token: async () => `tok${++n}`, lk: lk as unknown as LkRoomLike });
  const got: unknown[] = [];
  room.onPhone((m) => got.push(m));
  await room.join(60_000);
  expect(lk.attempts).toBe(3);
  expect(lk.tokens).toEqual(["tok1", "tok2", "tok3"]);
  expect(lk.handlers.get(RoomEvent.DataReceived)).toHaveLength(1);
  lk.emit(RoomEvent.DataReceived, new TextEncoder().encode(encodePhone({ t: "said", text: "hi" })), { identity: "phone" });
  lk.emit(RoomEvent.DataReceived, new TextEncoder().encode("{bad"), { identity: "phone" });
  lk.emit(RoomEvent.DataReceived, new TextEncoder().encode(encodePhone({ t: "said", text: "x" })), { identity: "other" });
  expect(got).toEqual([{ t: "said", text: "hi" }]);
}, 20_000);

test("Disconnected after joining fires onLost once; not before joining; not after close", async () => {
  const lk = new FakeLk(0);
  const room = new Room({ url: "ws://x", token: async () => "t", lk: lk as unknown as LkRoomLike });
  let lost = 0;
  room.onLost(() => lost++);
  lk.emit(RoomEvent.Disconnected);
  expect(lost).toBe(0);
  await room.join();
  lk.emit(RoomEvent.Disconnected);
  expect(lost).toBe(1);
  await room.close();
  lk.emit(RoomEvent.Disconnected);
  expect(lost).toBe(1);
});

test("the phone joining fires onPhoneJoined, whether it arrives after the voice or was there first", async () => {
  const lk = new FakeLk(0);
  lk.remoteParticipants.set("phone", { identity: "phone", trackPublications: new Map() });
  const room = new Room({ url: "ws://x", token: async () => "t", lk: lk as unknown as LkRoomLike });
  let joined = 0;
  room.onPhoneJoined(() => joined++);
  await room.join();
  expect(joined).toBe(1);
  lk.emit(RoomEvent.ParticipantConnected, { identity: "voice-old" });
  expect(joined).toBe(1);
  lk.emit(RoomEvent.ParticipantConnected, { identity: "phone" });
  expect(joined).toBe(2);
});
