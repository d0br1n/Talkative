import type { AgentToVoice } from "../shared/link.js";

/**
 * Turns a link drop closed on the voice side. After a link-only drop, the
 * agent may carry on an old turn without a fresh turnStart: what it still
 * sends for that turn is ignored until the turn's turnEnd. A fresh turnStart
 * for the same id is a new turn (a restarted agent counts from agent-1
 * again), so it reopens the id. An agent restart forgets every id.
 */
export class ClosedTurns {
  private readonly ids = new Set<string>();

  close(ids: Iterable<string>): void {
    for (const id of ids) this.ids.add(id);
  }

  /** Whether to ignore this message. A turnStart or turnEnd for a closed id forgets it. */
  ignores(m: AgentToVoice): boolean {
    if (!("turnId" in m) || !this.ids.has(m.turnId)) return false;
    if (m.t === "turnStart" || m.t === "turnEnd") this.ids.delete(m.turnId);
    return m.t !== "turnStart";
  }

  clear(): void {
    this.ids.clear();
  }
}
