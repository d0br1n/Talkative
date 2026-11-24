import type { AgentToVoice } from "../shared/link.js";
import type { ToPhone } from "../shared/phone.js";
import type { PhonePort } from "./mouth.js";

type Card = Extract<ToPhone, { t: "approval" }>;

/**
 * The approvals the phone shows. Each card keeps the deadline it was first
 * given; one whose deadline passes, or that a fresh agent host can no longer
 * answer, is ended on the phone as timed out. Expiry runs on a timer per card
 * and again on every access, so an injected clock is enough in tests.
 */
export class PendingApprovals {
  private readonly cards = new Map<string, Card>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly o: { phone: PhonePort; now: () => number; timeoutMs: number },
  ) {}

  /** Store (or, re-sent after a reconnect, replace) a card and show it. True when the id is new. */
  add(m: Extract<AgentToVoice, { t: "approval" }>): boolean {
    this.expire();
    const known = this.cards.get(m.id);
    const expiresAt = known?.expiresAt ?? this.o.now() + this.o.timeoutMs;
    const card: Card = { t: "approval", id: m.id, tool: m.tool, summary: m.summary, detail: m.detail, expiresAt };
    this.cards.set(m.id, card);
    this.o.phone.send(card);
    if (known) return false;
    const timer = setTimeout(() => this.expire(), Math.max(0, expiresAt - this.o.now()));
    (timer as any).unref?.();
    this.timers.set(m.id, timer);
    return true;
  }

  has(id: string): boolean {
    this.expire();
    return this.cards.has(id);
  }

  get size(): number {
    this.expire();
    return this.cards.size;
  }

  /** The agent ended it. True when it was still pending here. */
  done(id: string): boolean {
    return this.remove(id);
  }

  /** Every pending card, again (a phone joined). */
  resend(): void {
    this.expire();
    for (const card of this.cards.values()) this.o.phone.send(card);
  }

  /** Nobody can answer these any more (a fresh agent host): end each on the phone. */
  dropAll(): void {
    for (const id of [...this.cards.keys()]) this.timeOut(id);
  }

  /** End every card whose deadline has passed. */
  expire(): void {
    const t = this.o.now();
    for (const [id, card] of [...this.cards]) if (t >= card.expiresAt) this.timeOut(id);
  }

  private timeOut(id: string): void {
    if (this.remove(id)) this.o.phone.send({ t: "approvalDone", id, allow: false, by: "timeout" });
  }

  private remove(id: string): boolean {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    return this.cards.delete(id);
  }
}
