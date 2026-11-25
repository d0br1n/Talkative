import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FIXTURE_PATH, fixtureText, fixtures } from "../../scripts/phone-fixtures";

test("the committed Swift fixtures are what the script generates", () => {
  expect(readFileSync(FIXTURE_PATH, "utf8")).toBe(fixtureText());
});

test("fixture strings are the encoded samples", () => {
  const f = fixtures();
  expect(f.toPhone.length).toBeGreaterThan(0);
  expect(f.fromPhone.every((s) => typeof s === "string")).toBe(true);
});
