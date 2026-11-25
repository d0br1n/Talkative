// The voice side's conversation: frames from the room in, turns to the agent
// out, the agent's streamed replies spoken sentence by sentence, and the phone
// told everything. Speech and the agent meet only here.
import type { AgentToVoice, Effort, VoiceToAgent, Verbosity } from "../shared/link.js";
import type { FromPhone, ToPhone } from "../shared/phone.js";
import { AgentPhase } from "./agent-phase.js";
import { PendingApprovals } from "./approvals.js";
import { matchCommand, type Command } from "./commands.js";
import { DEFAULT_EAR_SETTINGS, Ear, type EarSettings } from "./ear.js";
import { HeldLines, type Cuttable } from "./held.js";
import { LINES, type Line } from "./lines.js";
import { Mouth, type PhonePort, type Speaker, type Tts } from "./mouth.js";
import { SentenceCollector } from "./sentences.js";
import { ClosedTurns } from "./turns.js";
import { speakable } from "./speakable.js";

export type { PhonePort, Speaker, Tts };

export interface Stt {
  transcribe(pcm16k: Int16Array): Promise<string>;
}

export interface AgentPort {
  /** False when the link is not up and the message was not sent. */
  send(m: VoiceToAgent): boolean;
}

/** The agent host's default approval timeout; the phone shows the deadline. */
export const APPROVAL_TIMEOUT_MS = 1_800_000;

export interface VoiceConversationOptions {
  stt: Stt;
  tts: Tts;
  speaker: Speaker;
  agent: AgentPort;
  phone: PhonePort;
  verbosity?: Verbosity;
  ear?: Partial<EarSettings>;
  /** Epoch-ms clock for approval deadlines. */
  now?: () => number;
  approvalTimeoutMs?: number;
  /** The model and effort the agent host starts with. */
  model: string;
  effort: Effort;
  /** Where the phone's `log` messages go; dropped when absent. */
  phoneLog?: { write(level: "info" | "error", text: string): void };
}

interface Turn extends Cuttable {
  origin: "owner" | "agent";
  collector: SentenceCollector;
  /** the next sentence index */
  sentences: number;
}

/** Sent to the phone when a decision cannot reach the agent. */
export const DECIDE_NOT_SENT = "Not connected to the agent; your answer wasn't sent.";

/** Sent to the phone when a settings change cannot reach the agent. */
export const SETTINGS_NOT_SENT = "Not connected to the agent; the change wasn't made.";

/** System lines go to the mouth under this turn id. */
const VOICE_TURN = "voice";

export class VoiceConversation {
  private readonly ear: Ear;
  private readonly mouth: Mouth;
  private verbosity: Verbosity;
  private model: string;
  private effort: Effort;

  private readonly turns = new Map<string, Turn>();
  /** owner turns sent and not ended: the status's `thinking` */
  private readonly ownerTurns = new Set<string>();
  /** turns a link drop closed here */
  private readonly closed = new ClosedTurns();
  private readonly jobs = new Set<string>();
  private sentTurns = 0;
  private linkUp = false;
  private everUp = false;
  /** settings went to the agent: its states until the restart they cause still carry the old values */
  private settingsInFlight = false;
  private readonly agentPhase = new AgentPhase();
  private audio = true;
  private mic = true;
  private lines = 0;
  /** what would start speaking while the owner is mid-utterance waits here */
  private readonly gate: HeldLines;
  private readonly approvals: PendingApprovals;
  private lastStatus = "";
  /** transcriptions in the order their utterances ended */
  private hearing: Promise<void> = Promise.resolve();

  constructor(private readonly o: VoiceConversationOptions) {
    this.verbosity = o.verbosity ?? "normal";
    this.model = o.model;
    this.effort = o.effort;
    this.approvals = new PendingApprovals({
      phone: o.phone, now: o.now ?? Date.now, timeoutMs: o.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
    });
    this.mouth = new Mouth({
      tts: o.tts,
      speaker: o.speaker,
      phone: o.phone,
      onSpeaking: (on) => (this.ear.speaking = on),
    });
    this.ear = new Ear({
      ...DEFAULT_EAR_SETTINGS,
      ...o.ear,
      onUtterance: (pcm) => this.onUtterance(pcm),
      onSpeechStart: () => {},
      onBargeIn: () => this.bargeIn(),
    });
    this.gate = new HeldLines(this.mouth, () => this.ear.inUtterance);
  }

  // ---- the room ----

  /** One 48 kHz mono frame of the owner's microphone. */
  onFrame(frame48k: Int16Array): void {
    if (!this.mic) return;
    this.ear.push(frame48k);
    if (this.gate.waiting && !this.ear.inUtterance) this.gate.release();
  }

  private onUtterance(pcm16k: Int16Array): void {
    // each link catches its own errors, so one bad utterance never stops the ones after it
    this.hearing = this.hearing.then(async () => {
      let text: string;
      try {
        text = (await this.o.stt.transcribe(pcm16k)).trim();
      } catch (e) {
        return this.fail(`transcription failed: ${(e as Error).message}`);
      }
      try {
        if (text) this.heard(text);
      } catch (e) {
        this.fail((e as Error).message);
      }
    });
  }

  private fail(text: string): void {
    console.error(`voice: ${text}`);
    try {
      this.o.phone.send({ t: "error", text });
    } catch {}
  }

  /** The voice is talking and the owner talks over it: stop the voice, not the agent. */
  private bargeIn(): void {
    this.silenceVoiced();
    this.mouth.stop();
  }

  private heard(text: string): void {
    this.o.phone.send({ t: "heard", text });
    const command = matchCommand(text);
    if (command) this.command(command);
    else this.sendTurn(text);
  }

  private settings(m: Extract<FromPhone, { t: "settings" }>): void {
    const change: { model?: string; effort?: Effort } = {};
    if (m.model !== undefined && m.model !== this.model) change.model = m.model;
    if (m.effort !== undefined && m.effort !== this.effort) change.effort = m.effort;
    if (change.model !== undefined || change.effort !== undefined) {
      // the coordinator restarts and resumes its session: that restart is not announced
      if (!this.linkUp || !this.o.agent.send({ t: "settings", ...change })) {
        this.o.phone.send({ t: "error", text: SETTINGS_NOT_SENT });
        this.sendSettings();
        return;
      }
      this.agentPhase.askedRestart();
      this.settingsInFlight = true;
      if (change.model !== undefined) this.model = change.model;
      if (change.effort !== undefined) this.effort = change.effort;
    }
    if (m.verbosity !== undefined) this.verbosity = m.verbosity;
    this.sendSettings();
  }

  private sendSettings(): void {
    this.o.phone.send({ t: "settings", verbosity: this.verbosity, model: this.model, effort: this.effort });
  }

  private command(c: Command): void {
    switch (c) {
      case "stop":
        this.silenceAll();
        this.mouth.stop();
        this.o.agent.send({ t: "interrupt" });
        return;
      case "new conversation":
        this.silenceAll();
        this.mouth.stop();
        if (this.linkUp && this.o.agent.send({ t: "newConversation" })) {
          this.agentPhase.askedRestart();
          this.closed.clear();
          this.say(LINES.newConversation);
        } else this.say(LINES.notConnected);
        return;
      case "audio off":
      case "audio on":
        this.setAudio(c === "audio on");
        return;
      case "continue":
        // nothing spoken approves anything: approvals are made in the app
        this.say(this.approvals.size > 0 ? LINES.approveOnPhone : LINES.nothingWaiting);
        return;
    }
  }

  private sendTurn(text: string): void {
    const turnId = `o-${this.sentTurns + 1}`;
    const reachable = this.linkUp && this.agentPhase.phase !== "crashed";
    if (!reachable || !this.o.agent.send({ t: "turn", turnId, text, verbosity: this.verbosity })) {
      this.say(LINES.notConnected);
      return;
    }
    this.sentTurns++;
    this.ownerTurns.add(turnId);
    this.status();
  }

  private setAudio(on: boolean): void {
    this.audio = on;
    if (!on) {
      this.gate.clear();
      this.mouth.stop();
    }
    this.status();
  }

  // ---- the agent ----

  onAgentConnection(up: boolean): void {
    if (up === this.linkUp) return;
    this.linkUp = up;
    if (up) {
      // not ready yet: the agent's state, sent on every welcome, says what it is (and whether it is back)
      this.agentPhase.linkUp(this.everUp ? "drop" : "first");
      this.everUp = true;
      this.status();
      return;
    }
    this.agentPhase.linkDown();
    this.settingsInFlight = false;
    // the agent cannot finish what was open, and its jobs went with it as far as we can tell
    this.closed.close([...this.turns.keys(), ...this.ownerTurns]);
    this.turns.clear();
    this.ownerTurns.clear();
    this.jobs.clear();
    this.status();
    this.say(LINES.lost);
  }

  onAgent(m: AgentToVoice): void {
    if (this.closed.ignores(m)) return;
    switch (m.t) {
      case "hello":
        return;
      case "agent":
        this.agentState(m);
        return;
      case "turnStart":
        // a stop may have silenced it before its start arrived
        this.turn(m.turnId).origin = m.origin;
        return;
      case "blockStart":
        this.o.phone.send({ t: "blockStart", turnId: m.turnId, block: m.block });
        return;
      case "delta": {
        this.o.phone.send({ t: "delta", turnId: m.turnId, block: m.block, text: m.text });
        const turn = this.turn(m.turnId);
        this.speakUnits(m.turnId, turn, turn.collector.push(m.text));
        return;
      }
      case "blockEnd": {
        this.o.phone.send({ t: "blockEnd", turnId: m.turnId, block: m.block });
        // the next block's text follows with no space: what is left here is a sentence of its own
        const turn = this.turns.get(m.turnId);
        if (turn) this.speakUnits(m.turnId, turn, turn.collector.flush());
        return;
      }
      case "tool":
        // the agent's summary already names the tool ("Bash: git push")
        if (m.phase === "start") this.o.phone.send({ t: "narration", text: m.summary });
        return;
      case "job":
        if (m.phase === "start") this.jobs.add(m.id);
        else this.jobs.delete(m.id);
        this.status();
        return;
      case "turnEnd": {
        const turn = this.turns.get(m.turnId);
        if (turn) this.speakUnits(m.turnId, turn, turn.collector.flush());
        this.turns.delete(m.turnId);
        this.ownerTurns.delete(m.turnId);
        if (!m.ok) {
          if (m.error) this.o.phone.send({ t: "error", text: m.error });
          // a failure is never silent: unless the owner cut it, or it said something already
          if (!turn?.silenced && !turn?.sentences) this.say(LINES.turnFailed);
        }
        this.status();
        return;
      }
      case "approval":
        this.approval(m);
        return;
      case "approvalDone": {
        const was = this.approvals.done(m.id);
        this.o.phone.send({ t: "approvalDone", id: m.id, allow: m.allow, by: m.by });
        if (was) this.say(m.by === "timeout" ? LINES.timedOut : m.allow ? LINES.approved : LINES.denied);
        return;
      }
    }
  }

  private agentState(m: Extract<AgentToVoice, { t: "agent" }>): void {
    const { state, detail } = m;
    if (state !== "ready") this.closed.clear();
    // a restarted coordinator does not end the jobs it dropped
    if (state === "restarting" || state === "crashed") this.jobs.clear();
    // only a fresh agent host says starting: nothing there can answer the old approvals
    if (state === "starting") {
      this.approvals.dropAll();
      // a fresh host starts with its configured values: bring it to the ones in force, and its
      // restart for them is not announced
      const model = m.model ?? this.o.model;
      const effort = m.effort ?? this.o.effort;
      if (this.model !== model || this.effort !== effort) {
        this.agentPhase.askedRestart();
        if (this.o.agent.send({ t: "settings", model: this.model, effort: this.effort })) this.settingsInFlight = true;
      }
    } else this.adopt(m);
    const { line, report } = this.agentPhase.update(state, detail);
    this.status();
    if (report) {
      console.error(`voice: the agent can't start: ${report}`);
      this.o.phone.send({ t: "error", text: report });
    }
    if (line) this.say(line);
  }

  /**
   * The agent host is the source of truth for its model and effort (a voice that restarted
   * starts from its config): take them and tell the phone when they changed. A state sent before
   * the restart our own settings asked for still carries the old ones, so those wait for it.
   */
  private adopt(m: Extract<AgentToVoice, { t: "agent" }>): void {
    if (this.settingsInFlight) {
      if (m.state !== "restarting") return;
      this.settingsInFlight = false;
    }
    let changed = false;
    if (m.model !== undefined && m.model !== this.model) {
      this.model = m.model;
      changed = true;
    }
    if (m.effort !== undefined && m.effort !== this.effort) {
      this.effort = m.effort;
      changed = true;
    }
    if (changed) this.sendSettings();
  }

  private approval(m: Extract<AgentToVoice, { t: "approval" }>): void {
    // a re-send after a reconnect replaces the entry by id, keeps its deadline, and is not announced again
    if (this.approvals.add(m)) this.say(LINES.needApproval);
  }

  // ---- the phone ----

  onPhone(m: FromPhone): void {
    switch (m.t) {
      case "hello":
        this.onPhoneJoined();
        return;
      case "mic":
        this.mic = m.on;
        if (!m.on) {
          this.ear.reset();
          this.gate.release();
        }
        return;
      case "audio":
        this.setAudio(m.on);
        return;
      case "said": {
        const text = m.text.trim();
        if (text) this.heard(text);
        return;
      }
      case "settings":
        this.settings(m);
        return;
      case "command":
        if (m.name === "quiet") this.bargeIn();
        else this.command(m.name);
        return;
      case "log":
        this.o.phoneLog?.write(m.level, m.text);
        return;
      case "decide":
        // a card whose end the phone missed (it timed out, or a fresh agent host dropped it while
        // the phone was away) would wait forever: end it there, and the agent never knew it
        if (!this.approvals.has(m.id)) {
          this.o.phone.send({ t: "approvalDone", id: m.id, allow: false, by: "timeout" });
          return;
        }
        // it stays pending either way: the agent still holds the request
        if (!this.o.agent.send({ t: "decide", id: m.id, allow: m.allow })) {
          this.o.phone.send({ t: "error", text: DECIDE_NOT_SENT });
        }
        return;
    }
  }

  /** The phone is in the room (or said hello): bring it up to date with the status and every pending approval. */
  onPhoneJoined(): void {
    this.approvals.resend();
    this.status(true);
    this.sendSettings();
  }

  /** The phone went away: a half-recorded utterance will never end, so drop it and say what waited. */
  onPhoneGone(): void {
    this.ear.reset();
    this.gate.release();
  }

  // ---- speaking ----

  private newTurn(origin: "owner" | "agent"): Turn {
    return { origin, collector: new SentenceCollector(), sentences: 0, voiced: false, silenced: false };
  }

  /** The turn a message belongs to, made on the spot if its start never came. */
  private turn(turnId: string): Turn {
    let turn = this.turns.get(turnId);
    if (!turn) {
      turn = this.newTurn(this.ownerTurns.has(turnId) ? "owner" : "agent");
      this.turns.set(turnId, turn);
    }
    return turn;
  }

  /** Each unit from the collector, filtered to what may be said; the phone gets every sentence. */
  private speakUnits(turnId: string, turn: Turn, units: string[]): void {
    for (const unit of units) {
      const { speak } = speakable(unit);
      if (!speak) continue;
      const index = turn.sentences++;
      this.o.phone.send({ t: "sentence", turnId, index, text: speak });
      if (!this.audio || turn.silenced) continue;
      // a reply nobody asked for never talks over the owner
      this.gate.say({ turn, turnId, index, text: speak }, turn.origin === "agent");
    }
  }

  /** A line in the voice's own words, held like an unprompted reply. */
  private say(line: Line): void {
    if (!this.audio) return;
    this.gate.say({ turnId: VOICE_TURN, index: this.lines++, text: line }, true);
  }

  private silenceVoiced(): void {
    for (const turn of this.turns.values()) if (turn.voiced) turn.silenced = true;
  }

  private silenceAll(): void {
    // an owner turn sent and not yet started is silenced too: its start keeps the flag
    for (const id of this.ownerTurns) this.turn(id);
    for (const turn of this.turns.values()) turn.silenced = true;
    this.gate.clear();
  }

  private status(force = false): void {
    const phase = this.agentPhase.phase;
    const agent = !this.linkUp || phase === "crashed" ? "down" : phase === "ready" ? "ready" : "restarting";
    const s: ToPhone = { t: "status", agent, thinking: this.ownerTurns.size > 0, jobs: this.jobs.size, audio: this.audio };
    const key = JSON.stringify(s);
    if (!force && key === this.lastStatus) return;
    this.lastStatus = key;
    this.o.phone.send(s);
  }
}
