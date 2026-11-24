// The voice side's conversation: frames from the room in, turns to the agent
// out, the agent's streamed replies spoken sentence by sentence, and the phone
// told everything. Speech and the agent meet only here.
import type { AgentToVoice, VoiceToAgent, Verbosity } from "../shared/link.js";
import type { FromPhone, ToPhone } from "../shared/phone.js";
import { matchCommand, type Command } from "./commands.js";
import { DEFAULT_EAR_SETTINGS, Ear, type EarSettings } from "./ear.js";
import { HeldLines, type Cuttable } from "./held.js";
import { LINES, type Line } from "./lines.js";
import { Mouth, type PhonePort, type Speaker, type Tts } from "./mouth.js";
import { SentenceCollector } from "./sentences.js";
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
}

type Approval = Extract<ToPhone, { t: "approval" }>;
type Phase = "starting" | "ready" | "restarting" | "crashed";

interface Turn extends Cuttable {
  origin: "owner" | "agent";
  collector: SentenceCollector;
  /** the next sentence index */
  sentences: number;
}

/** Sent to the phone when a decision cannot reach the agent. */
export const DECIDE_NOT_SENT = "Not connected to the agent; your answer wasn't sent.";

/** System lines go to the mouth under this turn id. */
const VOICE_TURN = "voice";

export class VoiceConversation {
  private readonly ear: Ear;
  private readonly mouth: Mouth;
  private readonly verbosity: Verbosity;
  private readonly now: () => number;
  private readonly approvalTimeoutMs: number;

  private readonly turns = new Map<string, Turn>();
  /** owner turns sent and not ended: the status's `thinking` */
  private readonly ownerTurns = new Set<string>();
  /** turns a link drop closed here: what the agent still sends for them is ignored until their turnEnd */
  private readonly closed = new Set<string>();
  private readonly jobs = new Set<string>();
  private sentTurns = 0;
  private linkUp = false;
  private everUp = false;
  private phase: Phase = "starting";
  /** our own newConversation restarts the agent: that restart is not announced again */
  private restartAsked = false;
  private audio = true;
  private mic = true;
  private lines = 0;
  /** what would start speaking while the owner is mid-utterance waits here */
  private readonly gate: HeldLines;
  private readonly pending = new Map<string, Approval>();
  private readonly announced = new Set<string>();
  private lastStatus = "";
  /** transcriptions in the order their utterances ended */
  private hearing: Promise<void> = Promise.resolve();

  constructor(private readonly o: VoiceConversationOptions) {
    this.verbosity = o.verbosity ?? "normal";
    this.now = o.now ?? Date.now;
    this.approvalTimeoutMs = o.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS;
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
          this.restartAsked = true;
          this.say(LINES.newConversation);
        } else this.say(LINES.notConnected);
        return;
      case "audio off":
      case "audio on":
        this.setAudio(c === "audio on");
        return;
      case "continue":
        // nothing spoken approves anything: approvals are made in the app
        this.say(this.pending.size > 0 ? LINES.approveOnPhone : LINES.nothingWaiting);
        return;
    }
  }

  private sendTurn(text: string): void {
    const turnId = `o-${this.sentTurns + 1}`;
    const reachable = this.linkUp && this.phase !== "crashed";
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
      this.phase = "ready";
      this.status();
      if (this.everUp) this.say(LINES.back);
      this.everUp = true;
      return;
    }
    // the agent cannot finish what was open, and its jobs went with it as far as we can tell
    for (const id of [...this.turns.keys(), ...this.ownerTurns]) this.closed.add(id);
    this.turns.clear();
    this.ownerTurns.clear();
    this.jobs.clear();
    this.restartAsked = false;
    this.status();
    this.say(LINES.lost);
  }

  onAgent(m: AgentToVoice): void {
    if ("turnId" in m && this.closed.has(m.turnId)) {
      if (m.t === "turnEnd") this.closed.delete(m.turnId);
      return;
    }
    switch (m.t) {
      case "hello":
        return;
      case "agent":
        this.agentState(m.state);
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
        if (m.phase === "start") this.o.phone.send({ t: "narration", text: `${m.name}: ${m.summary}` });
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
        if (!m.ok && m.error) this.o.phone.send({ t: "error", text: m.error });
        this.status();
        return;
      }
      case "approval":
        this.approval(m);
        return;
      case "approvalDone": {
        const was = this.pending.delete(m.id);
        this.announced.delete(m.id);
        this.o.phone.send({ t: "approvalDone", id: m.id, allow: m.allow, by: m.by });
        if (was) this.say(m.by === "timeout" ? LINES.timedOut : m.allow ? LINES.approved : LINES.denied);
        return;
      }
    }
  }

  private agentState(state: Phase): void {
    const was = this.phase;
    this.phase = state;
    if (state === "restarting" || state === "crashed") {
      // a restarted coordinator does not end the jobs it dropped
      this.jobs.clear();
    }
    this.status();
    if (state === "restarting" && was !== "restarting") {
      if (this.restartAsked) this.restartAsked = false;
      else this.say(LINES.restarting);
    }
    if (state === "crashed" && was !== "crashed") this.say(LINES.cantStart);
    if (state === "ready") this.restartAsked = false;
  }

  private approval(m: Extract<AgentToVoice, { t: "approval" }>): void {
    // a re-send after a reconnect replaces the entry by id and keeps its deadline
    const expiresAt = this.pending.get(m.id)?.expiresAt ?? this.now() + this.approvalTimeoutMs;
    const card: Approval = { t: "approval", id: m.id, tool: m.tool, summary: m.summary, detail: m.detail, expiresAt };
    this.pending.set(m.id, card);
    this.o.phone.send(card);
    if (this.announced.has(m.id)) return;
    this.announced.add(m.id);
    this.say(LINES.needApproval);
  }

  // ---- the phone ----

  onPhone(m: FromPhone): void {
    switch (m.t) {
      case "hello":
        for (const card of this.pending.values()) this.o.phone.send(card);
        this.status(true);
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
      case "decide":
        // it stays pending either way: the agent still holds the request
        if (this.pending.has(m.id) && !this.o.agent.send({ t: "decide", id: m.id, allow: m.allow })) {
          this.o.phone.send({ t: "error", text: DECIDE_NOT_SENT });
        }
        return;
    }
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
    const agent = !this.linkUp || this.phase === "crashed" ? "down" : this.phase === "ready" ? "ready" : "restarting";
    const s: ToPhone = { t: "status", agent, thinking: this.ownerTurns.size > 0, jobs: this.jobs.size, audio: this.audio };
    const key = JSON.stringify(s);
    if (!force && key === this.lastStatus) return;
    this.lastStatus = key;
    this.o.phone.send(s);
  }
}
