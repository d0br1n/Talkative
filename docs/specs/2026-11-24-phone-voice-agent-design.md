# Design: spoken conversations with a Claude Code coordinator from an iPhone

Date: 2026-11-24. Status: ready for the owner's approval (builder check done). Working name: not chosen yet (the doc says "the project").
Background research: [`research/oss-landscape.md`](../../research/oss-landscape.md).

---

## 1. Intent

The owner wants to talk with a Claude Code session the way they would with a colleague. They want to discuss architecture, choices and decisions, cut in mid-sentence, and get short spoken answers. They want to do this from an iPhone at the gym or in transit, with the phone in a pocket, the screen locked and earbuds in.

The agent runs on the owner's Linux laptop as **one coordinator session that runs its own subagents**. Speech recognition and speech output run on hardware the owner controls. No third-party cloud hears the audio or sees the session by default.

Why: Anthropic's Remote Control has no voice, and the official `/voice` only dictates. Happy, the closest phone tool, sends audio and session context to ElevenLabs. Desk voice tools (voicemode, parlar, claude-talk) use the PC's own mic. Sidetone (crsmithdev/sidetone, MIT) has the right shape, but it needs CUDA, runs one machine only, and its phone client is Android. The project will be open source.

## 2. Goals

1. A full-duplex spoken conversation with the coordinator. **Barge-in** (speaking while it talks) stops its speech at once.
2. It works with the iPhone screen locked, through earbuds, over mobile data with dropouts.
3. Replies are spoken in plain language. Code, diffs, tables and paths are never read aloud. They appear in the app's transcript for when the owner looks.
4. The agent keeps working through a network dropout. When the phone comes back, the owner is told what they missed.
5. The agent speaks up unprompted when it finishes something or needs a decision, as long as the phone is connected.
6. **Two deployment shapes from the same code, chosen by configuration:**
   - **Split** (the owner's starting choice): the voice side runs on an always-on server (Oracle Cloud, 4 ARM cores, 24 GB RAM, CPU only). The laptop runs only the agent side.
   - **Single machine**: everything runs on one Linux machine, using its CPU or its NVIDIA GPU. No server is needed.
7. The project is installable by someone other than the owner, from the repo and its docs.
8. **The coordinator stays available for conversation while its subagents work** (owner's decision). It delegates substantial work to subagents running in the background. It answers questions about progress and keeps discussing other things while they run. When a subagent finishes, it reports the result on its own.

## 3. Non-goals (v1)

- More than one voice conversation at a time, or switching between several independent sessions by voice. There is one coordinator. Subagents are its business.
- An Android app, and compatibility with sidetone's existing Android app. The phone protocol may be redesigned freely. (My call.)
- App Store or TestFlight distribution (see 7.4: nothing may block it later).
- Push notifications or waking the app when it is not running. A free Apple account cannot use push.
- Windows or macOS as the host for the agent side or the voice side.
- Attaching to a Claude Code TUI the owner already has open. The project starts and owns its coordinator (see 6.3).
- Keeping the laptop awake. If the laptop sleeps, the agent is gone, and the app must say so (see 5.6).

## 4. Anti-goals (failure even if it "works")

- Audio, transcripts or session content leaving the owner's machines by default. Cloud engines may exist only as an explicit opt-in, off by default, and labelled as such.
- The voice side starving the agent side of memory on a single machine. The owner has already had the laptop crash from running out of RAM with several agents.
- Reading code, file paths or diffs aloud.
- A spoken "yes" that is misheard or reflexive approving a destructive action.
- Silence the owner cannot interpret: a dropped connection, a crashed coordinator or a long tool run must each sound different from "still thinking".

## 5. Constraints

5.1 **No Mac, no paid Apple account.** The iOS app is built as an unsigned `.ipa` on GitHub Actions macOS runners (free for public repos). The owner installs it with **SideStore** using a free Apple ID. That means a 7-day signature, renewed on the phone by SideStore, and at most 3 sideloaded apps. Consequences: no simulator or debugger locally, so the app must ship good on-device logging that it sends to the server (sidetone's screen log and crash reports are the model). No push entitlement. Background audio mode is allowed.

5.2 **Hardware.**
- Laptop: Linux, RTX 3050 Ti (~4 GB VRAM), RAM limited enough that several agents have crashed it.
- Server: Oracle ARM, 4 cores, 24 GB RAM, no GPU, always on.
- Everything is reachable over **Tailscale**. The phone runs the Tailscale iOS app.

5.3 **Latency.** Sidetone measured about 3.0 s from end of speech to first sound on a GPU with Kokoro, on short no-tool prompts. That splits into 1.5 s end-of-turn pause, 1.3–1.9 s for the agent's first sentence, and 0.15 s for local speech. Real turns in its logs ran a 2.9 s median for the agent alone. Estimated (not measured) for the Oracle CPU: +0.3–0.8 s with a fast STT model and Piper, more with Kokoro, and Whisper medium is too slow. **Targets** on short no-tool prompts, measured at the phone over mobile data:
- Split on CPU: round trip p50 ≤ 4.0 s.
- Single machine on GPU: p50 ≤ 3.5 s.

The targets assume Claude Sonnet at default effort, which is the model sidetone measured with. Opus or higher effort will be slower, and the owner accepts that: model and effort are per-session settings on the Options screen. (My call.)

**Acceptable accuracy** (my call): on the owner's own clips (milestone 8.1), every spoken command and the gate word "continue" must be recognised in at least 95% of clips, and word error rate on ordinary sentences must be at most 10%. If no CPU engine meets both the accuracy bar and the latency target, the project continues on the single-machine GPU shape while the split shape is revisited. The owner decides at that point.

5.4 **Licences.**
- Code taken from sidetone and Happy is MIT: keep their copyright notices.
- Nothing GPL may be linked into the iOS app, because App Store terms conflict with GPL (VLC was pulled in 2011).
- GPL speech engines (the current Piper, `piper1-gpl`) are acceptable only as separate server processes reached over HTTP or a pipe, never linked into the project's own code.
- claude-talk has no licence: nothing may be copied from it.
- The project's own licence: MIT (my call, matching its two sources).

5.5 **Claude Code integration** must use supported interfaces: `claude -p --input-format stream-json --output-format stream-json`, as sidetone does, or the Agent SDK's streaming input. Do not use Remote Control or the Channels preview. Auth is the owner's normal Claude Code login. Do not use `--bare`, which needs an API key and skips hooks, MCP and CLAUDE.md.

5.6 **Failure must be audible.** Each of these gets a distinct spoken line or cue: the phone lost its connection, the voice side lost the agent side, the coordinator crashed and is restarting, and the coordinator is busy on a long tool run. Sidetone's "waiting / starting / stalled" readings, its cues and its hold music are the model.

## 6. Architecture

### 6.1 The two sides

The key split, decided here: sidetone's single bridge process is divided in two along the line between audio and text.

```
iPhone app (SwiftUI, LiveKit Swift SDK, background audio)
   │  WebRTC audio + data channel, over Tailscale
   ▼
VOICE SIDE  ── LiveKit server (self-hosted)
            ── voice service: joins the room as a participant; owns the ear
               (VAD, end of turn, barge-in), the mouth (sentence queue, hold,
               cues), spoken commands, the narration, pairing, what-you-missed
            ── speech engines: STT, TTS, turn detector (local processes)
   │  text-only protocol (WebSocket), agent side dials out to voice side
   ▼
AGENT SIDE  ── agent host: spawns and supervises ONE Claude Code coordinator
               on stream-json, sends turns in, streams replies and tool events
               out, applies the spoken-reply instructions, handles the gate,
               shows files, project switching
            ── Claude Code coordinator → its subagents
```

- **Split shape:** the voice side runs on the server and the agent side on the laptop. Only text crosses between them. The laptop holds no speech models and no LiveKit.
- **Single-machine shape:** both sides run on one machine, connected over loopback.

The two shapes differ only in configuration: addresses, and which engine build to use. There are no code paths specific to either.

The agent side **dials out** to the voice side and reconnects with backoff. That way the laptop needs no inbound port, and a laptop that wakes from sleep rejoins by itself.

### 6.2 What comes from where

| Piece | Source | Treatment |
|---|---|---|
| Ear, mouth, sentence cutter, hold, cues, narrator, spoken commands, "continue" gate, the control-channel vocabulary, fake phone and latency bench | sidetone `src/{ear,mouth,sentences,narrator,commands,gated,channel,protocol,cues,news}.ts`, `scripts/{fake-phone,latency-bench}.ts` | Copy, then split: everything audio goes in the voice service |
| Coordinator process: spawn on stream-json, resume, crash/loop supervisor, slow-session fork | sidetone `src/{session,supervisor,fork}.ts` | Copy into the agent host |
| Pairing (three-word code plus long-lived token), Tailscale HTTPS cert | sidetone `src/keys.ts`, ADR 0005, `deploy/` | Copy into the voice service |
| Speech workers | sidetone `speech/*_worker.py` (CUDA only) | **Replace** (6.4) |
| iOS app skeleton: LiveKit connection, audio session, room UI | `livekit-examples/agent-starter-swift` (MIT) | Start from it |
| iOS transcript rendering: markdown, code blocks, diffs, file viewer, status row, options screen | Happy `packages/happy-ios` (MIT, native Swift/UIKit), for components and visual design; sidetone's Android app and `CONTEXT.md` for behaviour and wording | Borrow components and patterns. Do not take Happy's networking, relay, encryption or ElevenLabs call code |
| Voice-agent ideas: separate context channel vs prompt channel, holding prompts while someone speaks, a voice permission tool | Happy `docs/voice-architecture.md`, parlar | Ideas only |

The project is a **new repository**. It is not a fork of either source, so neither upstream's history or scope comes along.

### 6.3 Agent host

- Starts one Claude Code coordinator in a configured project directory, with the owner's normal settings, plus an appended system prompt for the spoken style (6.6). Subagents run inside it through Claude Code's own subagent mechanism. The host does not manage them.
- Keeps it warm. On a crash or a loop, it restarts with `--resume` and tells the voice side, which says so (5.6). Sidetone's supervisor does this.
- **Memory guard (anti-goal 4.2):** the host watches system available memory. Below a threshold, it tells the voice side so the owner hears a warning. The coordinator's subagents are its own concern, but the owner must hear about memory pressure before an out-of-memory kill rather than after.
- Turns from the voice side go into the coordinator's stdin. A spoken "stop" interrupts the current turn. It does not stop background subagents. Stopping one is a request the owner makes to the coordinator, such as "drop the refactor".
- **Conversational coordinator (goal 8):**
  - The appended system prompt tells the coordinator to delegate any work longer than a short lookup to background subagents, and to keep its own turns short.
  - The coordinator's turns are therefore mostly brief, and mid-turn speech is queued until the turn ends, as in sidetone. A turn should rarely last long enough for that queue to matter.
  - The host tracks **background jobs** separately from **turns**: when each starts, a one-line label for it, and when it ends with what result.
  - When a background job finishes, the host wakes the coordinator with a short synthetic turn so it can report the result. If the owner is speaking or a turn is running, it waits. Sidetone's "detached job" is the nearest existing piece.
  - The voice side's status reading separates "thinking" (a turn is running) from "N jobs running in the background". The second does not block conversation.
- Streams out text deltas, block boundaries, tool-start and tool-end events (for narration), job-start and job-end events, and turn end.
- Keeps a log of the turn's text and events while the voice side is unreachable, and replays it when the voice side reconnects.

**Session lifecycle** (my call):
- The coordinator starts when the agent host starts, not when the phone connects, so it is ready before the owner reaches the gym.
- Opening the app rejoins the same conversation. A conversation continues until the owner says the command "new conversation" or uses the matching button in Options. Claude Code's own context compaction handles long sessions.
- **Project switching** means restarting the single coordinator in another directory, chosen from a configured list of projects, by voice command or from Options. Sidetone already does this. It is not a second simultaneous session.

### 6.4 Speech engines

- One small interface per engine kind: STT (whole utterance in, text out, with a vocabulary prompt), TTS (one sentence in, PCM stream out), and the turn detector. Each implementation is a separate local process, reached over HTTP or a pipe.
- Implementations must cover three targets: **ARM64 CPU** (the server), **x86-64 CPU**, and **x86-64 with CUDA** (the laptop).
- Engines start as these candidates, to be chosen by the benchmark (8):
  - STT on CPU: Whisper base.en or small.en (faster-whisper int8 or whisper.cpp), Parakeet TDT (via sherpa-onnx or similar), Moonshine.
  - STT on GPU: Whisper small.en or medium.en.
  - TTS: Piper (as a separate process because of the GPL), Kokoro (kokoro-onnx).
  - Turn detector: Smart Turn v3. Sidetone runs it in shadow mode. Here it should actually end turns once proven, since it is the largest latency lever.
- An OpenAI-compatible server (speaches, voicebox) may be used if it meets the latency and ARM requirements. voicebox ships no ARM64 image, and speaches is unverified on ARM. Running the engines directly is acceptable.
- **Cloud engines:** allowed behind the same interface only if explicitly configured, off by default, and logged at startup as sending audio off the machine.
- **Single machine:** the speech processes run with a memory cap (cgroup or container limit) so they cannot push the agents into an out-of-memory kill. On a GPU machine, models stay in VRAM and system RAM use stays small. The model choice is configurable per machine.

### 6.5 iOS app

- SwiftUI on the LiveKit Swift SDK, starting from `agent-starter-swift`, with the `audio` background mode. Stays in the room with the screen locked. Uses the system's echo cancellation (voice-processing I/O).
- **Screens:**
  - Conversation: transcript bubbles per block, greying the text the voice has not reached yet, file cards that open a read-only viewer, and a status row with sidetone's readings.
  - Options: verbosity, model, effort, ear thresholds, audio on/off, hold music.
  - Pairing: server address plus three-word code.
- Headset and earbud controls: play/pause stops speech, the same as a barge-in. (My call. Remote-control events while in a room need checking on-device.)
- Reconnects after a network change or dropout without user action, and shows "waiting" while it does.
- Logging: the screen log, crash reports and a connection log go to the voice side on the next connection, because there is no debugger (5.1).
- The CI workflow builds an unsigned `.ipa` on every push to main and attaches it to a GitHub release. The README documents SideStore install and renewal.

### 6.6 Spoken replies

- An appended system prompt tells the coordinator: speak as in conversation, put the conclusion first, keep the first sentence short, never read code, paths, diffs or tables aloud, and say "it's on your screen" instead. Verbosity (brief, normal, full) is set per turn, as in sidetone.
- The voice side additionally strips any code blocks and tables from speech before TTS, as a backstop. The transcript keeps them.
- Proactive speech: when a turn ends while the owner is silent and the phone is connected, the reply is spoken. When the phone is not connected, it is queued for "what you missed" (6.7).

### 6.7 Dropouts and "what you missed"

- The voice side keeps the conversation going when the phone drops: it records replies, events and the gate state.
- On rejoin it plays a cue and gives a one-to-two-sentence spoken summary of what happened while the phone was away. That includes background jobs that finished or are still running. The transcript fills in the full text. Sidetone's `news.ts` is the starting point.
- If a gated action is pending, it is re-asked after rejoin, never assumed (see 6.8 for how it is held).

### 6.8 Permissions and the gate

Sidetone's model (ADR 0009): the coordinator runs permissively inside the project, and a defined list of risky actions requires the spoken word **"continue"** (not "yes"). The gate fails closed.

How a gated action is held (my call):
- The gated tool call is **held** (blocked), not denied, while the owner is asked.
- If the phone is disconnected, the hold continues and the question is re-asked on rejoin.
- The hold times out to "no" after a configurable time. The default is 30 minutes, which covers a subway dropout. The timer runs whether or not the phone is connected.
- A timeout is reported to the coordinator as a denial, with the reason "owner unreachable". The owner hears it in what-you-missed.

The gate must also catch actions taken by **subagents**. It is implemented as a `PreToolUse` hook in the coordinator's settings, which subagents also pass through. The hook asks the agent host, and the agent host asks the voice side. (My call.)

The list of gated actions is configurable. It starts from sidetone's spec 10.7, plus anything that pushes, deletes outside the project, or spends money.

### 6.9 Security

- Everything is reachable only over Tailscale. LiveKit and the voice service never bind to a public interface. (My call: sidetone does the same.)
- Phone pairing uses a three-word code, exchanged once for a long-lived token, and the app stores the token in the iOS Keychain.
- The agent side authenticates to the voice side with a shared secret set at install.
- Optional opt-in cloud engines are the only path by which audio leaves the machines (anti-goal 4.1).

## 7. Approaches considered

| Approach | Trade-off | Outcome |
|---|---|---|
| Contribute to Happy and replace its ElevenLabs voice | Polished iOS app and a community, but its voice is a hosted ElevenLabs agent wired into native Swift and Kotlin with no endpoint to swap. Voice is currently off for Claude Code sessions, and it is a large, fast-moving codebase to edit without a Mac | Rejected as a base. UI pieces are borrowed |
| Fork sidetone whole | Closest architecture, but CUDA-only, single machine, Android client, one maintainer | Rejected as a fork. Its local modules are copied into a new repo |
| Build on Pipecat with its iOS client | No separate LiveKit server, but it rewrites everything sidetone already solved on the Claude side | Rejected |
| Off-the-shelf SIP softphone (Linphone) to LiveKit SIP | No iOS code at all, but voice-only, no custom UI, and phone-call audio quality | Rejected by the owner in favour of their own app from day one. It stays possible later because LiveKit SIP joins the same rooms |
| **New repo: sidetone's bridge split into voice and agent sides, plus a new SwiftUI app with Happy's UI pieces, sideloaded** | Two shapes from one codebase, iOS without a Mac or a paid account. Costs: CI-only iOS iteration, 7-day signatures | **Chosen by the owner** |

7.4 **Release later:** free distribution is an unsigned `.ipa` on GitHub. TestFlight or the App Store needs the $99/year developer account, a demo mode or test server for reviewers, and no GPL code in the app. The design keeps all of that possible. There is no need to build it now.

## 8. First milestones (order decided, contents left to the plan)

1. **Engine benchmark** on the Oracle box and on the laptop. **The owner records the clips** with iPhone Voice Memos and earbuds: a printed card of about 30 lines, read at the gym and in transit. The card includes every command and "continue", plus sentences full of project words. The card text is the reference transcript, which is sidetone's method (`docs/whisper-scores.md`). Use real clips of the owner's voice recorded at the gym and in transit, and compare STT candidates on word error rate and decode time, and TTS candidates on time to first audio. This picks the engines and confirms or revises the latency targets in 5.3.
   **In parallel, a background-subagent check:**
   - Confirm that a coordinator driven headless over stream-json can start background subagents, keep taking new turns while they run, and emit an event the host can see when each one finishes.
   - If it cannot, find the workaround before building the agent host. One candidate: the host runs each job as its own headless Claude Code process and reports to the coordinator. Bring the result to the owner, because it changes how goal 8 is met.
2. Voice side and agent side, connected and tested with sidetone's fake phone, in both shapes.
3. iOS app over CI and SideStore. Measure round trips at the phone on mobile data.
4. Dropout handling, what-you-missed, the memory guard, the gate.

## 9. Left to the builder

- Language and runtime per process. Sidetone is Bun and TypeScript plus Python workers. Keeping that is the default.
- The exact wire format of the voice-to-agent protocol, if it carries the events in 6.3.
- How to package and install each shape (containers, systemd units or both), as long as both shapes install from the repo's docs.
- Which Happy iOS components are worth porting, and how much to adapt them.
- Exact thresholds, timeouts and cue sounds.
- The project's name.

## 10. Calls I made (for the owner to check)

- The audio/text split between the voice side and the agent side (6.1), and the agent side dialling out.
- A new repo, not a fork.
- MIT as the project licence.
- Tailscale-only binding.
- Earbud play/pause acting as a barge-in.
- A memory guard that warns rather than throttling the owner's agents.
- Turning Smart Turn on as the end-of-turn decider once proven, rather than leaving it in shadow.
- Latency targets measured with Sonnet at default effort; model and effort choosable per session.
- Accuracy bar: commands and "continue" recognised in ≥ 95% of clips, ≤ 10% word error rate. If the CPU fails it, fall back to the single-machine GPU shape, and the owner decides.
- The coordinator starts with the agent host; a conversation continues until "new conversation"; project switching restarts the one coordinator in another configured directory.
- Gated actions are held, not denied, for up to 30 minutes (the timer keeps running during dropouts), re-asked on rejoin, and enforced through a `PreToolUse` hook so subagents are covered too.
- No compatibility with sidetone's Android app; the phone protocol may be redesigned.
- A background job is reported to the owner by waking the coordinator with a short synthetic turn.
