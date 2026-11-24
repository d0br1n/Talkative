// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureHome, homeDir, writeSecretFile } from "../config";

export interface Keys {
  apiKey: string;
  apiSecret: string;
}

const random = (bytes: number) => randomBytes(bytes).toString("base64url");

/** Made once, then kept in `keys.json` (mode 600). Losing the file only means pairing the phone again. */
export function loadOrCreateKeys(path = join(homeDir(), "keys.json")): Keys {
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Keys>;
    if (parsed.apiKey && parsed.apiSecret) return { apiKey: parsed.apiKey, apiSecret: parsed.apiSecret };
  }
  const keys: Keys = { apiKey: `tk${random(9)}`, apiSecret: random(32) };
  ensureHome();
  writeSecretFile(path, `${JSON.stringify(keys, null, 2)}\n`);
  return keys;
}

/** What livekit-server needs so that it and the voice agree. `node_ip` is the address the phone will use. */
export function livekitYaml(keys: Keys, bind: string): string {
  return [
    "port: 7880",
    "rtc:",
    "  tcp_port: 7881",
    "  port_range_start: 50000",
    "  port_range_end: 50019",
    `  node_ip: ${bind}`,
    "  use_external_ip: false",
    "keys:",
    `  ${keys.apiKey}: ${keys.apiSecret}`,
    "",
  ].join("\n");
}

/** Write `livekit.yaml` (mode 600: it holds the secret). The docker command only mounts it. */
export function writeLivekitConfig(bind: string): { path: string; dockerCommand: string } {
  const keys = loadOrCreateKeys();
  const path = join(ensureHome(), "livekit.yaml");
  writeSecretFile(path, livekitYaml(keys, bind));
  const dockerCommand = [
    "docker run -d --name livekit --network host \\",
    `  -v ${path}:/livekit.yaml \\`,
    "  livekit/livekit-server --config /livekit.yaml",
  ].join("\n");
  return { path, dockerCommand };
}
