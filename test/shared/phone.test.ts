import { describe, expect, test } from "bun:test";
import { PhoneProtocolError, decodeFromPhone, decodeToPhone, encodePhone } from "../../src/shared/phone";
import { BAD_SAMPLES, FROM_PHONE_SAMPLES, TO_PHONE_SAMPLES } from "./phone-samples";

describe("phone codec", () => {
  test("round-trips every ToPhone variant", () => {
    for (const m of TO_PHONE_SAMPLES) expect(decodeToPhone(encodePhone(m))).toEqual(m);
  });
  test("round-trips every FromPhone variant", () => {
    for (const m of FROM_PHONE_SAMPLES) expect(decodeFromPhone(encodePhone(m))).toEqual(m);
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
  test("settings fields are all optional, and model and command names are closed sets", () => {
    expect(decodeFromPhone('{"t":"settings"}')).toEqual({ t: "settings" });
    expect(() => decodeFromPhone('{"t":"settings","model":"gpt"}')).toThrow(PhoneProtocolError);
    expect(() => decodeFromPhone('{"t":"command","name":"approve"}')).toThrow(PhoneProtocolError);
  });
  test("every bad sample throws", () => {
    for (const b of BAD_SAMPLES) {
      const decode = b.dir === "toPhone" ? decodeToPhone : decodeFromPhone;
      expect(() => decode(b.json)).toThrow(PhoneProtocolError);
    }
  });
});
