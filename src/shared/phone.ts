import type { Effort, Verbosity } from "./link";
import { parseMessage, type FieldSpec } from "./validate";

export const PHONE_PROTOCOL = 1;
/** Largest data-channel message we will send, from sidetone. */
export const MAX_PHONE_MESSAGE_BYTES = 60000;

export const PHONE_MODELS = ["haiku", "sonnet", "opus"] as const;
export type PhoneModel = (typeof PHONE_MODELS)[number];
const VERBOSITY = ["brief", "normal", "full"] as const;
const EFFORT = ["default", "low", "medium", "high"] as const;
const COMMANDS = ["stop", "new conversation", "quiet"] as const;

export type ToPhone =
  | { t: "heard"; text: string }
  | { t: "blockStart" | "blockEnd"; turnId: string; block: number }
  | { t: "delta"; turnId: string; block: number; text: string }
  | { t: "sentence"; turnId: string; index: number; text: string }
  /** `turnId: "voice"` marks one of the voice's own system lines, not an agent turn. */
  | { t: "speaking"; turnId: string; index: number }
  | { t: "narration"; text: string }
  | { t: "status"; agent: "ready" | "restarting" | "down"; thinking: boolean; jobs: number; audio: boolean }
  | { t: "error"; text: string }
  /** The settings in force, sent on join and after every phone `settings`. */
  | { t: "settings"; verbosity: Verbosity; model: string; effort: Effort }
  /** `expiresAt` is epoch milliseconds. */
  | { t: "approval"; id: string; tool: string; summary: string; detail: string; expiresAt: number }
  | { t: "approvalDone"; id: string; allow: boolean; by: "owner" | "timeout" };

export type FromPhone =
  | { t: "hello"; protocol: number }
  | { t: "mic"; on: boolean }
  | { t: "audio"; on: boolean }
  /** A typed turn, used by the fake phone and tests. */
  | { t: "said"; text: string }
  | { t: "decide"; id: string; allow: boolean }
  | { t: "settings"; verbosity?: Verbosity; model?: PhoneModel; effort?: Effort }
  | { t: "command"; name: (typeof COMMANDS)[number] }
  | { t: "log"; level: "info" | "error"; text: string };

export class PhoneProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneProtocolError";
  }
}

const TO_PHONE: Record<string, FieldSpec> = {
  heard: { text: "string" },
  blockStart: { turnId: "string", block: "number" },
  blockEnd: { turnId: "string", block: "number" },
  delta: { turnId: "string", block: "number", text: "string" },
  sentence: { turnId: "string", index: "number", text: "string" },
  speaking: { turnId: "string", index: "number" },
  narration: { text: "string" },
  status: { agent: ["ready", "restarting", "down"], thinking: "boolean", jobs: "number", audio: "boolean" },
  error: { text: "string" },
  settings: { verbosity: VERBOSITY, model: "string", effort: EFFORT },
  approval: { id: "string", tool: "string", summary: "string", detail: "string", expiresAt: "number" },
  approvalDone: { id: "string", allow: "boolean", by: ["owner", "timeout"] },
};

const FROM_PHONE: Record<FromPhone["t"], FieldSpec> = {
  hello: { protocol: "number" },
  mic: { on: "boolean" },
  audio: { on: "boolean" },
  said: { text: "string" },
  decide: { id: "string", allow: "boolean" },
  settings: { "verbosity?": VERBOSITY, "model?": PHONE_MODELS, "effort?": EFFORT },
  command: { name: COMMANDS },
  log: { level: ["info", "error"], text: "string" },
};

const fail = (msg: string): never => {
  throw new PhoneProtocolError(msg);
};

export function encodePhone(m: ToPhone | FromPhone): string {
  const s = JSON.stringify(m);
  if (new TextEncoder().encode(s).length > MAX_PHONE_MESSAGE_BYTES) {
    throw new PhoneProtocolError(`message exceeds ${MAX_PHONE_MESSAGE_BYTES} bytes`);
  }
  return s;
}

export function decodeToPhone(s: string): ToPhone {
  return parseMessage<ToPhone>(s, TO_PHONE, fail);
}

export function decodeFromPhone(s: string): FromPhone {
  return parseMessage<FromPhone>(s, FROM_PHONE, fail);
}
