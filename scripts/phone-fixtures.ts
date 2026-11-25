// Writes the phone-message fixtures the Swift codec is tested against.
// Run: bun scripts/phone-fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { encodePhone } from "../src/shared/phone";
import { BAD_SAMPLES, FROM_PHONE_SAMPLES, TO_PHONE_SAMPLES } from "../test/shared/phone-samples";

export const FIXTURE_PATH = new URL(
  "../ios/TalkativeCore/Tests/TalkativeCoreTests/Fixtures/phone-messages.json",
  import.meta.url,
).pathname;

export function fixtures() {
  return {
    toPhone: TO_PHONE_SAMPLES.map(encodePhone),
    fromPhone: FROM_PHONE_SAMPLES.map(encodePhone),
    bad: BAD_SAMPLES,
  };
}

/** The exact text of the fixture file. */
export const fixtureText = () => JSON.stringify(fixtures(), null, 2) + "\n";

if (import.meta.main) {
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, fixtureText());
  console.log(`wrote ${FIXTURE_PATH}`);
}
