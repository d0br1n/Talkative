// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureHome, homeDir, writeSecretFile } from "../config";

/** The livekit-server image, pinned: the version the end-to-end test runs against. */
export const LIVEKIT_IMAGE = "livekit/livekit-server:v1.13.11";

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

/**
 * What livekit-server needs so that it and the voice agree. `node_ip` is the address the phone will use.
 * `rtc.ips.includes` keeps the ICE UDP sockets on the bind address alone (without it they open on every
 * interface, LAN and public IPv6 included); the loopback flag lets that address be 127.0.0.1. The ICE TCP
 * port (7881) still listens on every address: livekit has no setting to bind it.
 */
export function livekitYaml(keys: Keys, bind: string): string {
  return [
    "port: 7880",
    `bind_addresses: ["${bind}"]`,
    "rtc:",
    "  tcp_port: 7881",
    "  port_range_start: 50000",
    "  port_range_end: 50019",
    `  node_ip: ${bind}`,
    "  use_external_ip: false",
    "  enable_loopback_candidate: true",
    "  ips:",
    `    includes: ["${bind}/32"]`,
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
    "docker run -d --name livekit --network host --restart unless-stopped \\",
    `  -v ${path}:/livekit.yaml \\`,
    `  ${LIVEKIT_IMAGE} --config /livekit.yaml`,
  ].join("\n");
  return { path, dockerCommand };
}
