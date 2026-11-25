// Every phone message variant, shared by the codec test and the Swift fixtures.
import { PHONE_PROTOCOL, type FromPhone, type ToPhone } from "../../src/shared/phone";

export const TO_PHONE_SAMPLES: ToPhone[] = [
  { t: "heard", text: "hi" },
  { t: "blockStart", turnId: "a", block: 0 },
  { t: "blockEnd", turnId: "a", block: 0 },
  { t: "delta", turnId: "a", block: 0, text: "x" },
  { t: "sentence", turnId: "a", index: 1, text: "Hello." },
  { t: "speaking", turnId: "a", index: 1 },
  { t: "narration", text: "running" },
  { t: "status", agent: "ready", thinking: false, jobs: 0, audio: true },
  { t: "error", text: "bad" },
  { t: "settings", verbosity: "normal", model: "sonnet", effort: "default" },
  { t: "approval", id: "p", tool: "Bash", summary: "s", detail: "{}", expiresAt: 1700000000000 },
  { t: "approvalDone", id: "p", allow: false, by: "owner" },
];

export const FROM_PHONE_SAMPLES: FromPhone[] = [
  { t: "hello", protocol: PHONE_PROTOCOL },
  { t: "mic", on: true },
  { t: "audio", on: false },
  { t: "said", text: "hello" },
  { t: "decide", id: "p", allow: true },
  { t: "settings" },
  { t: "settings", verbosity: "brief" },
  { t: "settings", verbosity: "full", model: "opus", effort: "high" },
  { t: "command", name: "stop" },
  { t: "command", name: "new conversation" },
  { t: "command", name: "quiet" },
  { t: "log", level: "info", text: "connected" },
  { t: "log", level: "error", text: "mic failed" },
];

export const BAD_SAMPLES: { dir: "toPhone" | "fromPhone"; json: string }[] = [
  { dir: "toPhone", json: "{" },
  { dir: "fromPhone", json: "{" },
  { dir: "toPhone", json: '{"t":"nope"}' },
  { dir: "fromPhone", json: '{"t":"nope"}' },
  { dir: "fromPhone", json: '{"t":"mic"}' },
  { dir: "toPhone", json: '{"t":"settings","verbosity":"normal","model":"sonnet"}' },
  { dir: "fromPhone", json: '{"t":"settings","model":"gpt"}' },
  { dir: "fromPhone", json: '{"t":"command","name":"approve"}' },
  { dir: "toPhone", json: '{"t":"status","agent":"x","thinking":false,"jobs":0,"audio":true}' },
  { dir: "fromPhone", json: '{"t":"said","text":5}' },
  { dir: "fromPhone", json: '{"t":"log","level":"debug","text":"x"}' },
];
