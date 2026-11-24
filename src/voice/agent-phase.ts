import { LINES, type Line } from "./lines.js";

export type Phase = "starting" | "ready" | "restarting" | "crashed";

/**
 * What the voice believes about the agent, and what it says when that changes.
 * The link coming up tells nothing: the agent's state message (sent on every
 * welcome) does. Until it arrives the voice stays in the phase it had before
 * the link, `starting`.
 */
export class AgentPhase {
  phase: Phase = "starting";
  /** the link came back after a drop: the next state says whether the agent is back */
  private relinked = false;
  /** our own newConversation restarts the agent: that restart is not announced again */
  private restartAsked = false;
  private crashDetail: string | undefined;

  linkUp(after: "first" | "drop"): void {
    this.phase = "starting";
    this.relinked = after === "drop";
  }

  linkDown(): void {
    this.phase = "starting";
    this.relinked = false;
    this.restartAsked = false;
    this.crashDetail = undefined;
  }

  askedRestart(): void {
    this.restartAsked = true;
  }

  /** The agent's new state: the line to say, if any, and a crash reason not yet reported. */
  update(state: Phase, detail?: string): { line: Line | null; report: string | null } {
    const was = this.phase;
    this.phase = state;
    let line: Line | null = null;
    if (state === "restarting" && was !== "restarting") {
      if (this.restartAsked) this.restartAsked = false;
      else line = LINES.restarting;
    }
    if (state === "crashed" && was !== "crashed") line = LINES.cantStart;
    if (state === "ready") {
      if (was === "crashed" || (this.relinked && was !== "ready")) line = LINES.back;
      this.restartAsked = false;
    }
    // a fresh host says starting before its ready: the drop is still unanswered
    if (state !== "starting") this.relinked = false;
    const report = state === "crashed" && detail && (was !== "crashed" || detail !== this.crashDetail) ? detail : null;
    this.crashDetail = state === "crashed" ? detail : undefined;
    return { line, report };
  }
}
