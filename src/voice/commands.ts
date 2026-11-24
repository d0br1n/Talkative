// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.

export type Command = "stop" | "new conversation" | "audio off" | "audio on" | "continue";

const COMMANDS: readonly Command[] = ["stop", "new conversation", "audio off", "audio on", "continue"];

/** Lowercase, runs of non-[a-z0-9] become one space, trim. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A command only when the whole normalised utterance is one. */
export function matchCommand(utterance: string): Command | null {
  const n = normalise(utterance);
  return COMMANDS.find((c) => c === n) ?? null;
}
