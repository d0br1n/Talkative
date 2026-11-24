import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Effort, Verbosity } from "./shared/link";

export interface Config {
  linkSecret: string;
  voice: {
    bind: string; pairPort: number; linkPort: number;
    livekitUrl: string; room: string;
    python: string; stt: string; tts: string; memoryMaxMb: number;
    verbosity: Verbosity;
  };
  agent: { voiceUrl: string; project: string; model: string; effort: Effort };
}

/** `~/.talkative`, or `$TALKATIVE_HOME` (tests and the end-to-end run). Nothing is written outside it. */
export function homeDir(): string {
  return process.env.TALKATIVE_HOME || join(homedir(), ".talkative");
}

/** Make the directory (mode 700) if it is not there. */
export function ensureHome(): string {
  const dir = homeDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

/** Write a file readable by the owner only. */
export function writeSecretFile(path: string, text: string): void {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const REPO = join(import.meta.dir, "..");

const VERBOSITY = ["brief", "normal", "full"];
const EFFORT = ["default", "low", "medium", "high"];

function refuseWildcard(bind: string): void {
  if (bind === "0.0.0.0" || bind === "::" || bind === "[::]") {
    throw new Error("config: bind must be one address (a Tailscale IP or 127.0.0.1), never 0.0.0.0");
  }
}

export const codePath = (): string => join(homeDir(), "code");

/** Empty the pairing-code file, so a stale code is never printed. */
export function clearCode(): void {
  ensureHome();
  writeSecretFile(codePath(), "");
}

export function writeCode(code: string): void {
  ensureHome();
  writeSecretFile(codePath(), `${code}\n`);
}

export function initConfig(o: { bind: string; project: string; force?: boolean }): Config {
  refuseWildcard(o.bind);
  if (!o.force && existsSync(join(homeDir(), "config.json"))) {
    throw new Error("config.json already exists; --force overwrites it and rotates linkSecret (a copied laptop config stops working)");
  }
  if (!o.bind) throw new Error("config: bind is required");
  const config: Config = {
    linkSecret: randomBytes(32).toString("hex"),
    voice: {
      bind: o.bind, pairPort: 7890, linkPort: 7891,
      livekitUrl: `ws://${o.bind}:7880`, room: "talkative",
      python: join(REPO, ".venv", "bin", "python"), stt: "moonshine-base", tts: "piper-medium", memoryMaxMb: 3072,
      verbosity: "normal",
    },
    agent: { voiceUrl: `ws://${o.bind}:7891`, project: o.project, model: "sonnet", effort: "default" },
  };
  const dir = ensureHome();
  writeSecretFile(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

const obj = (v: unknown, name: string): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`config: ${name} must be an object`);
  return v as Record<string, unknown>;
};
const str = (o: Record<string, unknown>, k: string, at: string): string => {
  const v = o[k];
  if (typeof v !== "string" || v === "") throw new Error(`config: ${at}.${k} must be a non-empty string`);
  return v;
};
const int = (o: Record<string, unknown>, k: string, at: string): number => {
  const v = o[k];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`config: ${at}.${k} must be a non-negative integer`);
  return v;
};
const oneOf = <T extends string>(o: Record<string, unknown>, k: string, at: string, set: string[]): T => {
  const v = str(o, k, at);
  if (!set.includes(v)) throw new Error(`config: ${at}.${k} must be one of ${set.join(", ")}`);
  return v as T;
};

export function loadConfig(path = join(homeDir(), "config.json")): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`config: cannot read ${path}: ${(e as Error).message}`);
  }
  const r = obj(raw, "config");
  const v = obj(r.voice, "voice");
  const a = obj(r.agent, "agent");
  const bind = str(v, "bind", "voice");
  refuseWildcard(bind);
  return {
    linkSecret: str(r, "linkSecret", "config"),
    voice: {
      bind, pairPort: int(v, "pairPort", "voice"), linkPort: int(v, "linkPort", "voice"),
      livekitUrl: str(v, "livekitUrl", "voice"), room: str(v, "room", "voice"),
      python: str(v, "python", "voice"), stt: str(v, "stt", "voice"), tts: str(v, "tts", "voice"),
      memoryMaxMb: int(v, "memoryMaxMb", "voice"), verbosity: oneOf<Verbosity>(v, "verbosity", "voice", VERBOSITY),
    },
    agent: {
      voiceUrl: str(a, "voiceUrl", "agent"), project: str(a, "project", "agent"),
      model: str(a, "model", "agent"), effort: oneOf<Effort>(a, "effort", "agent", EFFORT),
    },
  };
}
