import type { Mouth } from "./mouth.js";

/** The reply a line belongs to: `voiced` once a line of it reached the mouth, `silenced` once a barge-in or a stop cut it. */
export interface Cuttable {
  voiced: boolean;
  silenced: boolean;
}

export interface HeldLine {
  /** none for one of the voice's own system lines */
  turn?: Cuttable;
  turnId: string;
  index: number;
  text: string;
}

/**
 * The gate in front of the mouth. A line that may not talk over the owner
 * waits here while they are mid-utterance and goes, in order, once they stop.
 * Each line keeps its turn, so a cut made after it was held still holds, even
 * once the turn has ended.
 */
export class HeldLines {
  private held: HeldLine[] = [];

  constructor(
    private readonly mouth: Pick<Mouth, "say">,
    private readonly midUtterance: () => boolean,
  ) {}

  /** Say it now, or hold it when it is `holdable` and the owner is talking. */
  say(line: HeldLine, holdable: boolean): void {
    if (holdable && this.midUtterance()) this.held.push(line);
    else this.voice(line);
  }

  get waiting(): boolean {
    return this.held.length > 0;
  }

  /** The owner stopped talking: say what waited for them, except what was cut meanwhile. */
  release(): void {
    for (const line of this.held.splice(0)) if (!line.turn?.silenced) this.voice(line);
  }

  clear(): void {
    this.held = [];
  }

  private voice(line: HeldLine): void {
    if (line.turn) line.turn.voiced = true;
    this.mouth.say(line.turnId, line.index, line.text);
  }
}
