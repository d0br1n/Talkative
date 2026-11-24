import { describe, expect, spyOn, test } from "bun:test";
import { LINES } from "../../src/voice/lines.js";
import { Mouth } from "../../src/voice/mouth.js";
import { FakePhone, FakeSpeaker, FakeTts, rig, settle } from "./harness.js";

const APPROVAL = { t: "approval", id: "req-1", tool: "Bash", summary: "Bash: git push origin main", detail: "{}" } as const;

describe("1. an utterance ends", () => {
  test("STT runs, the phone hears it, and a turn goes to the agent with o-<n> ids", async () => {
    const r = rig({ verbosity: "brief" });
    await r.utter("What time is it");
    expect(r.stt.calls).toBe(1);
    expect(r.phone.of("heard")).toEqual([{ t: "heard", text: "What time is it" }]);
    expect(r.agent.of("turn")).toEqual([{ t: "turn", turnId: "o-1", text: "What time is it", verbosity: "brief" }]);
    await r.utter("And the date");
    expect(r.agent.of("turn").map((m) => m.turnId)).toEqual(["o-1", "o-2"]);
  });

  test("a phone `said` is an utterance without STT", async () => {
    const r = rig();
    r.conv.onPhone({ t: "said", text: "Hello there" });
    await settle();
    expect(r.stt.calls).toBe(0);
    expect(r.phone.of("heard")).toEqual([{ t: "heard", text: "Hello there" }]);
    expect(r.agent.of("turn")).toEqual([{ t: "turn", turnId: "o-1", text: "Hello there", verbosity: "normal" }]);
  });

  test("stop stops the mouth and interrupts the agent", async () => {
    const r = rig();
    r.speaker.auto = false;
    r.conv.onPhone({ t: "said", text: "Tell me a story" });
    r.reply("o-1", "owner", ["Once upon a time there was a fox. "], false);
    await settle();
    expect(r.spoken()).toEqual(["Once upon a time there was a fox."]);
    // typed, so no barge-in plays a part: the command alone stops the voice
    r.conv.onPhone({ t: "said", text: "Stop." });
    expect(r.speaker.stops).toBe(1);
    expect(r.agent.of("interrupt")).toHaveLength(1);
    expect(r.agent.of("turn")).toHaveLength(1);
    // what is still in flight for that turn is not spoken
    r.agentSays({ t: "delta", turnId: "o-1", block: 0, text: "It ran into the woods. And then it slept. " });
    await settle();
    expect(r.spoken()).toEqual(["Once upon a time there was a fox."]);
  });

  test("new conversation tells the agent and says so; its own restart is not announced again", async () => {
    const r = rig();
    await r.utter("New conversation");
    expect(r.agent.of("newConversation")).toHaveLength(1);
    expect(r.agent.of("turn")).toHaveLength(0);
    r.agentSays({ t: "agent", state: "restarting" }, { t: "agent", state: "ready" });
    await settle();
    expect(r.spoken()).toEqual([LINES.newConversation]);
  });

  test("audio off and audio on toggle the audio and send status", async () => {
    const r = rig();
    await r.utter("Audio off");
    expect(r.phone.last("status")).toMatchObject({ audio: false });
    expect(r.agent.of("turn")).toHaveLength(0);
    await r.utter("audio on");
    expect(r.phone.last("status")).toMatchObject({ audio: true });
    expect(r.agent.of("turn")).toHaveLength(0);
  });

  test("continue never approves: it points at the phone, or says nothing is waiting", async () => {
    const r = rig();
    await r.utter("Continue");
    expect(r.spoken()).toEqual([LINES.nothingWaiting]);
    r.agentSays(APPROVAL);
    await settle();
    await r.utter("continue.");
    expect(r.spoken()).toEqual([LINES.nothingWaiting, LINES.needApproval, LINES.approveOnPhone]);
    expect(r.agent.of("decide")).toHaveLength(0);
    expect(r.agent.of("turn")).toHaveLength(0);
  });
});

describe("2. agent deltas", () => {
  test("go to the phone raw and to the mouth as speakable sentences", async () => {
    const r = rig();
    r.conv.onPhone({ t: "said", text: "show me" });
    const chunks = ["Here is the fix you asked for. ", "```ts\nconst x = 1;\n```\n", "Run the tests after."];
    r.reply("o-1", "owner", chunks);
    await settle();
    expect(r.phone.of("delta").map((d) => d.text)).toEqual(chunks);
    expect(r.spoken()).toEqual(["Here is the fix you asked for.", "It's on your screen.", "Run the tests after."]);
    expect(r.phone.of("sentence").map((s) => [s.turnId, s.index, s.text])).toEqual([
      ["o-1", 0, "Here is the fix you asked for."],
      ["o-1", 1, "It's on your screen."],
      ["o-1", 2, "Run the tests after."],
    ]);
    expect(r.phone.of("speaking").map((s) => [s.turnId, s.index])).toEqual([["o-1", 0], ["o-1", 1], ["o-1", 2]]);
  });

  test("with the audio off nothing is spoken but the phone still gets everything", async () => {
    const r = rig();
    r.conv.onPhone({ t: "audio", on: false });
    r.conv.onPhone({ t: "said", text: "status" });
    r.reply("o-1", "owner", ["All three builds are green. ", "Nothing else to report."]);
    await settle();
    expect(r.tts.synthed).toEqual([]);
    expect(r.spoken()).toEqual([]);
    expect(r.phone.of("delta")).toHaveLength(2);
    expect(r.phone.of("sentence")).toHaveLength(2);
  });

  test("a block boundary ends the sentence before it", async () => {
    const r = rig();
    r.conv.onPhone({ t: "said", text: "check it" });
    r.agentSays(
      { t: "turnStart", turnId: "o-1", origin: "owner" },
      { t: "blockStart", turnId: "o-1", block: 0 },
      { t: "delta", turnId: "o-1", block: 0, text: "I will look at the logs now." },
      { t: "blockEnd", turnId: "o-1", block: 0 },
    );
    await settle();
    expect(r.spoken()).toEqual(["I will look at the logs now."]);
    expect(r.phone.of("blockStart")).toEqual([{ t: "blockStart", turnId: "o-1", block: 0 }]);
    expect(r.phone.of("blockEnd")).toEqual([{ t: "blockEnd", turnId: "o-1", block: 0 }]);
  });
});

describe("3. barge-in", () => {
  test("stops the mouth, leaves the turn running, and the rest stays on the phone only", async () => {
    const r = rig();
    r.speaker.auto = false;
    r.conv.onPhone({ t: "said", text: "explain" });
    r.reply("o-1", "owner", ["First sentence is here. Second sentence is here. "], false);
    await settle();
    expect(r.spoken()).toEqual(["First sentence is here."]);
    r.stt.texts.push("hang on");
    r.talk(500); // loud for 500 ms while speaking: a barge-in
    expect(r.speaker.stops).toBe(1);
    expect(r.agent.of("interrupt")).toHaveLength(0);
    r.agentSays({ t: "delta", turnId: "o-1", block: 0, text: "Third sentence is here." }, { t: "turnEnd", turnId: "o-1", ok: true });
    r.pause();
    await settle();
    expect(r.spoken()).toEqual(["First sentence is here."]);
    expect(r.phone.of("delta").map((d) => d.text).join("")).toContain("Third sentence is here.");
    expect(r.agent.of("turn").map((m) => m.text)).toEqual(["explain", "hang on"]);
  });
});

describe("4. an unprompted turn mid-utterance (Review Focus 3)", () => {
  test("is held until the utterance ends, then spoken", async () => {
    const r = rig();
    r.stt.texts.push("okay");
    r.talk(200); // the owner is mid-utterance
    r.reply("agent-1", "agent", ["The build job finished. All tests passed. "]);
    await settle();
    expect(r.tts.synthed).toEqual([]);
    expect(r.phone.of("delta")).toHaveLength(1);
    r.pause();
    await settle();
    expect(r.spoken()).toEqual(["The build job finished.", "All tests passed."]);
    expect(r.phone.of("heard")).toEqual([{ t: "heard", text: "okay" }]);
  });

  test("an unprompted turn with nobody talking is spoken at once", async () => {
    const r = rig();
    r.reply("agent-1", "agent", ["The build job finished. All tests passed. "]);
    await settle();
    expect(r.spoken()).toEqual(["The build job finished.", "All tests passed."]);
  });
});

describe("5. status", () => {
  test("tool narration, the job count, and thinking", async () => {
    const r = rig();
    const before = r.phone.of("status").length;
    r.conv.onPhone({ t: "said", text: "deploy it" });
    expect(r.phone.last("status")).toEqual({ t: "status", agent: "ready", thinking: true, jobs: 0, audio: true });
    r.agentSays(
      { t: "turnStart", turnId: "o-1", origin: "owner" },
      { t: "tool", turnId: "o-1", phase: "start", name: "Bash", summary: "git push" },
      { t: "tool", turnId: "o-1", phase: "end", name: "Bash", summary: "git push" },
      { t: "job", phase: "start", id: "j1", label: "build" },
      { t: "job", phase: "start", id: "j2", label: "lint" },
    );
    expect(r.phone.of("narration")).toEqual([{ t: "narration", text: "Bash: git push" }]);
    expect(r.phone.last("status")).toMatchObject({ thinking: true, jobs: 2 });
    r.agentSays({ t: "turnEnd", turnId: "o-1", ok: true });
    expect(r.phone.last("status")).toMatchObject({ thinking: false, jobs: 2 });
    r.agentSays({ t: "job", phase: "end", id: "j1", label: "build" });
    expect(r.phone.last("status")).toMatchObject({ thinking: false, jobs: 1 });
    // one status per change: thinking on, j1, j2, thinking off, j1 end
    expect(r.phone.of("status").length - before).toBe(5);
    await settle();
    expect(r.tts.synthed).toEqual([]);
  });
});

describe("6. the link drops (Review Focus 1)", () => {
  test("closes the open turn, goes down, says so once, refuses turns, and comes back", async () => {
    const r = rig();
    r.conv.onPhone({ t: "said", text: "long job" });
    r.agentSays({ t: "turnStart", turnId: "o-1", origin: "owner" }, { t: "job", phase: "start", id: "j1", label: "x" });
    expect(r.phone.last("status")).toMatchObject({ thinking: true, jobs: 1 });
    r.agent.up = false;
    r.conv.onAgentConnection(false);
    r.conv.onAgentConnection(false);
    expect(r.phone.last("status")).toEqual({ t: "status", agent: "down", thinking: false, jobs: 0, audio: true });
    await settle();
    expect(r.spoken()).toEqual([LINES.lost]);
    await r.utter("Are you there");
    expect(r.agent.of("turn")).toHaveLength(1);
    expect(r.spoken()).toEqual([LINES.lost, LINES.notConnected]);
    r.agent.up = true;
    r.conv.onAgentConnection(true);
    await settle();
    expect(r.spoken()).toEqual([LINES.lost, LINES.notConnected, LINES.back]);
    expect(r.phone.last("status")).toEqual({ t: "status", agent: "ready", thinking: false, jobs: 0, audio: true });
  });

  test("no `back` line on the first connection", async () => {
    const r = rig({ connected: false });
    r.conv.onAgentConnection(true);
    await settle();
    expect(r.spoken()).toEqual([]);
    expect(r.phone.last("status")).toMatchObject({ agent: "ready" });
  });

  test("restarting and crashed are spoken once each and reset the job count", async () => {
    const r = rig();
    r.agentSays({ t: "job", phase: "start", id: "j1", label: "x" });
    r.agentSays({ t: "agent", state: "restarting" }, { t: "agent", state: "restarting" });
    expect(r.phone.last("status")).toMatchObject({ agent: "restarting", jobs: 0 });
    r.agentSays({ t: "job", phase: "start", id: "j2", label: "y" });
    r.agentSays({ t: "agent", state: "crashed", detail: "login expired" }, { t: "agent", state: "crashed" });
    expect(r.phone.last("status")).toMatchObject({ agent: "down", jobs: 0 });
    r.agentSays({ t: "agent", state: "ready" });
    expect(r.phone.last("status")).toMatchObject({ agent: "ready" });
    await settle();
    expect(r.spoken()).toEqual([LINES.restarting, LINES.cantStart]);
  });
});

describe("7. streaming", () => {
  test("the first sentence reaches tts.synth before turnEnd, and the next is made while it plays", async () => {
    const r = rig();
    r.speaker.auto = false;
    r.conv.onPhone({ t: "said", text: "go" });
    r.agentSays({ t: "turnStart", turnId: "o-1", origin: "owner" });
    r.agentSays({ t: "delta", turnId: "o-1", block: 0, text: "The first sentence " });
    expect(r.tts.synthed).toEqual([]);
    r.agentSays({ t: "delta", turnId: "o-1", block: 0, text: "is done. The second " });
    expect(r.tts.synthed).toEqual(["The first sentence is done."]);
    r.agentSays({ t: "delta", turnId: "o-1", block: 0, text: "one follows. And more" });
    await settle();
    // the first plays; the second is already made
    expect(r.spoken()).toEqual(["The first sentence is done."]);
    expect(r.tts.synthed).toEqual(["The first sentence is done.", "The second one follows."]);
    r.agentSays({ t: "turnEnd", turnId: "o-1", ok: true });
    r.speaker.finish();
    await settle();
    r.speaker.finish();
    await settle();
    r.speaker.finish();
    await settle();
    expect(r.spoken()).toEqual(["The first sentence is done.", "The second one follows.", "And more"]);
  });
});

describe("8. approvals in the app (Review Focus 6)", () => {
  test("stored, sent with expiresAt, announced once per id, and re-sent on phone hello", async () => {
    const r = rig({ now: () => 5_000 });
    r.agentSays(APPROVAL);
    expect(r.phone.of("approval")).toEqual([{ ...APPROVAL, expiresAt: 5_000 + 1_800_000 }]);
    r.agentSays(APPROVAL); // the same id again
    await settle();
    expect(r.spoken()).toEqual([LINES.needApproval]);
    r.phone.got = [];
    r.conv.onPhone({ t: "hello", protocol: 1 });
    expect(r.phone.of("approval")).toEqual([{ ...APPROVAL, expiresAt: 1_805_000 }]);
  });

  test("decide is forwarded only for a pending id", () => {
    const r = rig();
    r.conv.onPhone({ t: "decide", id: "nope", allow: true });
    expect(r.agent.of("decide")).toEqual([]);
    r.agentSays(APPROVAL);
    r.conv.onPhone({ t: "decide", id: "req-1", allow: true });
    expect(r.agent.of("decide")).toEqual([{ t: "decide", id: "req-1", allow: true }]);
    r.agentSays({ t: "approvalDone", id: "req-1", allow: true, by: "owner" });
    r.conv.onPhone({ t: "decide", id: "req-1", allow: false });
    expect(r.agent.of("decide")).toHaveLength(1);
  });

  test("approvalDone clears the entry, reaches the phone, and says how it ended", async () => {
    const r = rig();
    for (const id of ["a", "b", "c"]) r.agentSays({ ...APPROVAL, id });
    r.agentSays(
      { t: "approvalDone", id: "a", allow: true, by: "owner" },
      { t: "approvalDone", id: "b", allow: false, by: "owner" },
      { t: "approvalDone", id: "c", allow: false, by: "timeout" },
    );
    await settle();
    expect(r.phone.of("approvalDone").map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(r.spoken()).toEqual([LINES.needApproval, LINES.needApproval, LINES.needApproval, LINES.approved, LINES.denied, LINES.timedOut]);
    r.phone.got = [];
    r.conv.onPhone({ t: "hello", protocol: 1 });
    expect(r.phone.of("approval")).toEqual([]);
  });

  test("the notice is held while the owner is mid-utterance", async () => {
    const r = rig();
    r.stt.texts.push("one moment");
    r.talk(200);
    r.agentSays(APPROVAL);
    expect(r.phone.of("approval")).toHaveLength(1);
    await settle();
    expect(r.spoken()).toEqual([]);
    r.pause();
    await settle();
    expect(r.spoken()).toEqual([LINES.needApproval]);
  });

  test("a link drop keeps it listed; the agent's re-send replaces it with no duplicate", async () => {
    let clock = 0;
    const r = rig({ now: () => clock });
    r.agentSays(APPROVAL);
    clock = 60_000;
    r.agent.up = false;
    r.conv.onAgentConnection(false);
    r.phone.got = [];
    r.conv.onPhone({ t: "hello", protocol: 1 });
    expect(r.phone.of("approval").map((m) => m.id)).toEqual(["req-1"]);
    r.agent.up = true;
    r.conv.onAgentConnection(true);
    r.agentSays(APPROVAL); // connectAgent re-sends pending approvals after the welcome; the deadline stays
    await settle();
    expect(r.spoken().filter((l) => l === LINES.needApproval)).toHaveLength(1);
    r.phone.got = [];
    r.conv.onPhone({ t: "hello", protocol: 1 });
    expect(r.phone.of("approval")).toEqual([{ ...APPROVAL, expiresAt: 1_800_000 }]);
    r.conv.onPhone({ t: "decide", id: "req-1", allow: false });
    expect(r.agent.of("decide")).toEqual([{ t: "decide", id: "req-1", allow: false }]);
  });
});

describe("mixed: barge-in, then an unprompted job report", () => {
  test("the cut reply stays cut; the job report waits for the owner and is then spoken", async () => {
    const r = rig();
    r.speaker.auto = false;
    r.conv.onPhone({ t: "said", text: "what's left" });
    r.reply("o-1", "owner", ["Two things are left on the list. The first is the docs. "], false);
    await settle();
    expect(r.spoken()).toEqual(["Two things are left on the list."]);
    r.stt.texts.push("never mind that");
    r.talk(500); // barge-in; the owner keeps talking
    expect(r.speaker.stops).toBe(1);
    r.agentSays({ t: "delta", turnId: "o-1", block: 0, text: "The second is the deploy." }, { t: "turnEnd", turnId: "o-1", ok: true });
    r.agentSays({ t: "job", phase: "start", id: "j1", label: "tests" }, { t: "job", phase: "end", id: "j1", label: "tests" });
    r.reply("agent-1", "agent", ["The test job finished. Everything passed. "]);
    await settle();
    expect(r.spoken()).toEqual(["Two things are left on the list."]);
    r.speaker.auto = true;
    r.pause();
    await settle();
    expect(r.spoken()).toEqual(["Two things are left on the list.", "The test job finished.", "Everything passed."]);
    expect(r.agent.of("interrupt")).toHaveLength(0);
    expect(r.agent.of("turn").map((m) => m.text)).toEqual(["what's left", "never mind that"]);
    expect(r.phone.last("status")).toMatchObject({ jobs: 0 });
  });
});

describe("Mouth", () => {
  test("plays in order, emits speaking as each starts, and stop drops the queue", async () => {
    const tts = new FakeTts();
    const speaker = new FakeSpeaker();
    const phone = new FakePhone();
    speaker.auto = false;
    const mouth = new Mouth({ tts, speaker, phone });
    expect(mouth.busy).toBe(false);
    mouth.say("t", 0, "One two three.");
    mouth.say("t", 1, "Four five six.");
    mouth.say("t", 2, "Seven eight nine.");
    expect(mouth.busy).toBe(true);
    await settle();
    expect(phone.got).toEqual([{ t: "speaking", turnId: "t", index: 0 }]);
    expect(tts.synthed).toEqual(["One two three.", "Four five six."]);
    speaker.finish();
    await settle();
    expect(phone.got.at(-1)).toEqual({ t: "speaking", turnId: "t", index: 1 });
    mouth.stop();
    await settle();
    expect(mouth.busy).toBe(false);
    expect(speaker.played.map((p) => tts.textOf(p))).toEqual(["One two three.", "Four five six."]);
    mouth.say("u", 0, "After the stop.");
    await settle();
    expect(speaker.played.map((p) => tts.textOf(p)).at(-1)).toBe("After the stop.");
  });
});

describe("fix round 1", () => {
  test("a barge-in-cut unprompted reply stays cut after its turnEnd", async () => {
    const r = rig();
    r.speaker.auto = false;
    r.reply("agent-1", "agent", ["The build finished. "], false);
    await settle();
    expect(r.spoken()).toEqual(["The build finished."]);
    r.stt.texts.push("hang on");
    r.talk(100); // recording open, barge-in not yet
    r.agentSays({ t: "delta", turnId: "agent-1", block: 0, text: "Three tests failed. " });
    r.talk(500); // barge-in fires
    expect(r.speaker.stops).toBe(1);
    r.agentSays({ t: "turnEnd", turnId: "agent-1", ok: true });
    r.speaker.auto = true;
    r.pause();
    await settle();
    expect(r.spoken()).toEqual(["The build finished."]);
  });

  test("a throw while handling one utterance does not stop the next", async () => {
    const r = rig();
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const send = r.phone.send.bind(r.phone);
    let thrown = false;
    r.phone.send = (m) => {
      if (m.t === "heard" && !thrown) { thrown = true; throw new Error("data channel closed"); }
      send(m);
    };
    await r.utter("first");
    await r.utter("second");
    quiet.mockRestore();
    expect(r.agent.of("turn").map((m) => m.text)).toEqual(["second"]);
    expect(r.phone.of("error").map((m) => m.text)).toEqual(["data channel closed"]);
  });

  test("stop silences an owner turn whose turnStart has not arrived yet", async () => {
    const r = rig();
    r.conv.onPhone({ t: "said", text: "explain it" });
    r.conv.onPhone({ t: "said", text: "stop" });
    r.reply("o-1", "owner", ["This should not be spoken. Nor this."]);
    await settle();
    expect(r.spoken()).toEqual([]);
    expect(r.phone.of("sentence")).toHaveLength(2);
  });

  test("after a link-only drop, deltas of a locally closed turn are ignored until its turnEnd", async () => {
    const r = rig();
    r.conv.onPhone({ t: "said", text: "go on" });
    r.reply("o-1", "owner", ["Before the drop it is spoken. "], false);
    r.conv.onAgentConnection(false);
    r.conv.onAgentConnection(true);
    const deltas = r.phone.of("delta").length;
    r.agentSays({ t: "delta", turnId: "o-1", block: 0, text: "After the drop it is not. Nor this one. " });
    expect(r.phone.last("status")).toMatchObject({ thinking: false });
    r.agentSays({ t: "turnEnd", turnId: "o-1", ok: true });
    r.reply("agent-1", "agent", ["A later reply is spoken. "]);
    await settle();
    expect(r.phone.of("delta")).toHaveLength(deltas + 1);
    expect(r.spoken()).toEqual(["Before the drop it is spoken.", LINES.lost, LINES.back, "A later reply is spoken."]);
  });

  test("a crashed agent gets no turn: the voice says it isn't connected", async () => {
    const r = rig();
    r.agentSays({ t: "agent", state: "crashed" });
    r.conv.onPhone({ t: "said", text: "hello" });
    await settle();
    expect(r.agent.of("turn")).toEqual([]);
    expect(r.spoken()).toEqual([LINES.cantStart, LINES.notConnected]);
  });

  test("a decide that cannot be sent tells the phone and stays pending", () => {
    const r = rig();
    r.agentSays(APPROVAL);
    r.agent.up = false;
    r.conv.onPhone({ t: "decide", id: "req-1", allow: true });
    expect(r.phone.of("error")).toEqual([{ t: "error", text: "Not connected to the agent; your answer wasn't sent." }]);
    r.phone.got = [];
    r.conv.onPhone({ t: "hello", protocol: 1 });
    expect(r.phone.of("approval").map((m) => m.id)).toEqual(["req-1"]);
  });

  test("onPhoneGone drops the half-recorded utterance and releases held lines", async () => {
    const r = rig();
    r.talk(200);
    r.agentSays(APPROVAL);
    await settle();
    expect(r.spoken()).toEqual([]);
    r.conv.onPhoneGone();
    await settle();
    expect(r.spoken()).toEqual([LINES.needApproval]);
    expect(r.stt.calls).toBe(0);
  });
});
