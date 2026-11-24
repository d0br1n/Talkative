import { parseMessage, type FieldSpec } from "./validate";

export const LINK_VERSION = 1;

export type Verbosity = "brief" | "normal" | "full";
export type Effort = "default" | "low" | "medium" | "high";

export type AgentToVoice =
  | { t: "hello"; version: number; secret: string }
  | { t: "agent"; state: "starting" | "ready" | "restarting" | "crashed"; detail?: string }
  | { t: "turnStart"; turnId: string; origin: "owner" | "agent" }
  | { t: "blockStart"; turnId: string; block: number }
  | { t: "delta"; turnId: string; block: number; text: string }
  | { t: "blockEnd"; turnId: string; block: number }
  | { t: "tool"; turnId: string; phase: "start" | "end"; name: string; summary: string }
  | { t: "job"; phase: "start" | "end"; id: string; label: string; summary?: string }
  | { t: "turnEnd"; turnId: string; ok: boolean; error?: string }
  /** `summary` is one line, e.g. `Bash: git push origin main`; `detail` is the tool input as pretty JSON, capped at 4,000 characters. */
  | { t: "approval"; id: string; tool: string; summary: string; detail: string }
  | { t: "approvalDone"; id: string; allow: boolean; by: "owner" | "timeout" };

export type VoiceToAgent =
  | { t: "welcome"; version: number }
  | { t: "turn"; turnId: string; text: string; verbosity: Verbosity }
  | { t: "interrupt" }
  | { t: "newConversation" }
  | { t: "settings"; model?: string; effort?: Effort }
  | { t: "decide"; id: string; allow: boolean };

export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkError";
  }
}

const VERBOSITY = ["brief", "normal", "full"] as const;
const EFFORT = ["default", "low", "medium", "high"] as const;

const AGENT_TO_VOICE: Record<AgentToVoice["t"], FieldSpec> = {
  hello: { version: "number", secret: "string" },
  agent: { state: ["starting", "ready", "restarting", "crashed"], "detail?": "string" },
  turnStart: { turnId: "string", origin: ["owner", "agent"] },
  blockStart: { turnId: "string", block: "number" },
  delta: { turnId: "string", block: "number", text: "string" },
  blockEnd: { turnId: "string", block: "number" },
  tool: { turnId: "string", phase: ["start", "end"], name: "string", summary: "string" },
  job: { phase: ["start", "end"], id: "string", label: "string", "summary?": "string" },
  turnEnd: { turnId: "string", ok: "boolean", "error?": "string" },
  approval: { id: "string", tool: "string", summary: "string", detail: "string" },
  approvalDone: { id: "string", allow: "boolean", by: ["owner", "timeout"] },
};

const VOICE_TO_AGENT: Record<VoiceToAgent["t"], FieldSpec> = {
  welcome: { version: "number" },
  turn: { turnId: "string", text: "string", verbosity: VERBOSITY },
  interrupt: {},
  newConversation: {},
  settings: { "model?": "string", "effort?": EFFORT },
  decide: { id: "string", allow: "boolean" },
};

const fail = (msg: string): never => {
  throw new LinkError(msg);
};

export function encodeLink(m: AgentToVoice | VoiceToAgent): string {
  return JSON.stringify(m);
}

export function decodeAgentToVoice(s: string): AgentToVoice {
  return parseMessage<AgentToVoice>(s, AGENT_TO_VOICE, fail);
}

export function decodeVoiceToAgent(s: string): VoiceToAgent {
  return parseMessage<VoiceToAgent>(s, VOICE_TO_AGENT, fail);
}
