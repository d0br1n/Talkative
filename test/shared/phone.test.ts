import { describe, expect, test } from "bun:test";
import {
  PHONE_PROTOCOL, PhoneProtocolError, decodeFromPhone, decodeToPhone, encodePhone,
  type FromPhone, type ToPhone,
} from "../../src/shared/phone";

const toPhone: ToPhone[] = [
  { t: "heard", text: "hi" },
  { t: "blockStart", turnId: "a", block: 0 },
  { t: "blockEnd", turnId: "a", block: 0 },
  { t: "delta", turnId: "a", block: 0, text: "x" },
  { t: "sentence", turnId: "a", index: 1, text: "Hello." },
  { t: "speaking", turnId: "a", index: 1 },
  { t: "narration", text: "running" },
  { t: "status", agent: "ready", thinking: false, jobs: 0, audio: true },
  { t: "error", text: "bad" },
  { t: "approval", id: "p", tool: "Bash", summary: "s", detail: "{}", expiresAt: 1700000000000 },
  { t: "approvalDone", id: "p", allow: false, by: "owner" },
];
const fromPhone: FromPhone[] = [
  { t: "hello", protocol: PHONE_PROTOCOL },
  { t: "mic", on: true },
  { t: "audio", on: false },
  { t: "said", text: "hello" },
  { t: "decide", id: "p", allow: true },
];

describe("phone codec", () => {
  test("round-trips every ToPhone variant", () => {
    for (const m of toPhone) expect(decodeToPhone(encodePhone(m))).toEqual(m);
  });
  test("round-trips every FromPhone variant", () => {
    for (const m of fromPhone) expect(decodeFromPhone(encodePhone(m))).toEqual(m);
  });
  test("oversized message throws", () => {
    expect(() => encodePhone({ t: "delta", turnId: "a", block: 0, text: "x".repeat(70000) })).toThrow();
  });
  test("bad input throws PhoneProtocolError", () => {
    expect(() => decodeFromPhone('{"t":"mic"}')).toThrow(PhoneProtocolError);
    expect(() => decodeToPhone('{"t":"nope"}')).toThrow(PhoneProtocolError);
    expect(() => decodeToPhone("{")).toThrow(PhoneProtocolError);
    expect(() => decodeToPhone('{"t":"status","agent":"x","thinking":false,"jobs":0,"audio":true}')).toThrow(PhoneProtocolError);
  });
});
