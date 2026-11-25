import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("sidestore source for 0.3.0 and a 1,234-byte ipa", async () => {
  const dir = mkdtempSync(join(tmpdir(), "talkative-src-"));
  try {
    const ipa = join(dir, "Talkative.ipa");
    const out = join(dir, "source.json");
    writeFileSync(ipa, new Uint8Array(1234));
    const p = Bun.spawn(["bun", "scripts/sidestore-source.ts", "--version", "0.3.0", "--ipa", ipa, "--out", out], {
      stdout: "pipe", stderr: "pipe",
    });
    expect(await p.exited).toBe(0);
    const src = JSON.parse(readFileSync(out, "utf8"));
    const app = src.apps[0];
    expect(app.bundleIdentifier).toBe("io.github.d0br1n.talkative");
    expect(app.developerName).toBe("d0br1n");
    const v = app.versions[0];
    expect(v.version).toBe("0.3.0");
    expect(v.size).toBe(1234);
    expect(v.downloadURL).toBe("https://github.com/d0br1n/Talkative/releases/download/v0.3.0/Talkative.ipa");
    expect(v.minOSVersion).toBe("17.0");
    expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Number.isNaN(new Date(v.date).getTime())).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing arguments fail with usage", async () => {
  const p = Bun.spawn(["bun", "scripts/sidestore-source.ts", "--version", "0.3.0"], { stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).not.toBe(0);
});
