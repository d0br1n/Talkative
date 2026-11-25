// Fills ios/sidestore/source.template.json for one release.
// Usage: bun scripts/sidestore-source.ts --version <x.y.z> --ipa <path> --out <path>
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const usage = "usage: bun scripts/sidestore-source.ts --version <x.y.z> --ipa <path> --out <path>";

export function fillSource(template: any, version: string, size: number, date: Date): any {
  const src = structuredClone(template);
  const v = src.apps[0].versions[0];
  v.version = version;
  v.date = date.toISOString();
  v.downloadURL = `https://github.com/d0br1n/Talkative/releases/download/v${version}/Talkative.ipa`;
  v.size = size;
  v.minOSVersion = "17.0";
  return src;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const version = get("version"), ipa = get("ipa"), out = get("out");
  if (!version || !ipa || !out) {
    console.error(usage);
    process.exit(2);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`bad version ${version}\n${usage}`);
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const template = JSON.parse(readFileSync(join(root, "ios/sidestore/source.template.json"), "utf8"));
  writeFileSync(out, JSON.stringify(fillSource(template, version, statSync(ipa).size, new Date()), null, 2) + "\n");
}
