import type { AgentToVoice } from "../shared/link";

const LABEL_CAP = 80;
const DEFAULT_LABEL = "background job";

/**
 * Tracks top-level background jobs from stream-json `system` events.
 * `task_started` carries `description`; `task_notification` carries `summary` but no
 * description, so the label is remembered from the start. Tasks nested inside a subagent
 * (`parent_task_id` / `owned_by_subagent`) are ignored, and a notification for an id that
 * was never started emits nothing.
 */
export class JobTracker {
  private readonly jobs = new Map<string, string>();

  observe(ev: any): AgentToVoice[] {
    if (!ev || ev.type !== "system") return [];
    if (ev.subtype !== "task_started" && ev.subtype !== "task_notification") return [];
    if (ev.parent_task_id || ev.owned_by_subagent === true) return [];
    const id = typeof ev.task_id === "string" ? ev.task_id : "";
    if (!id) return [];
    if (ev.subtype === "task_started") {
      const label = typeof ev.description === "string" && ev.description ? ev.description.slice(0, LABEL_CAP) : DEFAULT_LABEL;
      this.jobs.set(id, label);
      return [{ t: "job", phase: "start", id, label }];
    }
    const label = this.jobs.get(id);
    if (label === undefined) return [];
    this.jobs.delete(id);
    const summary = typeof ev.summary === "string" && ev.summary ? ev.summary : undefined;
    return [{ t: "job", phase: "end", id, label, ...(summary ? { summary } : {}) }];
  }

  running(): number {
    return this.jobs.size;
  }

  reset(): void {
    this.jobs.clear();
  }
}
