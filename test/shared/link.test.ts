import { describe, expect, test } from "bun:test";
import {
  LINK_VERSION, LinkError, decodeAgentToVoice, decodeVoiceToAgent, encodeLink,
  type AgentToVoice, type VoiceToAgent,
} from "../../src/shared/link";

const agentToVoice: AgentToVoice[] = [
  { t: "hello", version: LINK_VERSION, secret: "s" },
  { t: "agent", state: "ready" },
  { t: "agent", state: "crashed", detail: "exit 1" },
  { t: "turnStart", turnId: "a", origin: "owner" },
  { t: "turnStart", turnId: "a", origin: "agent" },
  { t: "blockStart", turnId: "a", block: 0 },
  { t: "delta", turnId: "a", block: 0, text: "hi" },
  { t: "blockEnd", turnId: "a", block: 0 },
  { t: "tool", turnId: "a", phase: "start", name: "Bash", summary: "ls" },
  { t: "job", phase: "start", id: "j", label: "build" },
  { t: "job", phase: "end", id: "j", label: "build", summary: "ok" },
  { t: "turnEnd", turnId: "a", ok: true },
  { t: "turnEnd", turnId: "a", ok: false, error: "boom" },
  { t: "approval", id: "p", tool: "Bash", summary: "Bash: git push origin main", detail: "{}" },
  { t: "approvalDone", id: "p", allow: true, by: "timeout" },
];
const voiceToAgent: VoiceToAgent[] = [
  { t: "welcome", version: 1 },
  { t: "turn", turnId: "a", text: "hello", verbosity: "brief" },
  { t: "interrupt" },
  { t: "newConversation" },
  { t: "settings" },
  { t: "settings", model: "opus", effort: "high" },
  { t: "decide", id: "p", allow: false },
];

describe("link codec", () => {
  test("round-trips every AgentToVoice variant", () => {
    for (const m of agentToVoice) expect(decodeAgentToVoice(encodeLink(m))).toEqual(m);
  });
  test("round-trips every VoiceToAgent variant", () => {
    for (const m of voiceToAgent) expect(decodeVoiceToAgent(encodeLink(m))).toEqual(m);
  });
  test("missing field throws LinkError", () => {
    expect(() => decodeVoiceToAgent('{"t":"turn","turnId":"a"}')).toThrow(LinkError);
  });
  test("unknown t throws", () => {
    expect(() => decodeAgentToVoice('{"t":"nope"}')).toThrow(LinkError);
  });
  test("malformed JSON and non-objects throw", () => {
    expect(() => decodeAgentToVoice("{")).toThrow(LinkError);
    expect(() => decodeAgentToVoice("[]")).toThrow(LinkError);
    expect(() => decodeVoiceToAgent("null")).toThrow(LinkError);
  });
  test("mistyped or bad enum field throws", () => {
    expect(() => decodeAgentToVoice('{"t":"agent","state":"bogus"}')).toThrow(LinkError);
    expect(() => decodeAgentToVoice('{"t":"delta","turnId":"a","block":"0","text":"x"}')).toThrow(LinkError);
    expect(() => decodeVoiceToAgent('{"t":"settings","effort":"max"}')).toThrow(LinkError);
    expect(() => decodeVoiceToAgent('{"t":"turn","turnId":"a","text":"x","verbosity":"loud"}')).toThrow(LinkError);
  });
});
