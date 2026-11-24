# Milestone 2: Voice Side and Agent Side — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working voice side (LiveKit room, ear, mouth, speech workers, pairing) and agent side (one supervised Claude Code coordinator on stream-json, with background-job events), joined by a text-only link. Both deployment shapes run from the same code, and an end-to-end test drives them with a fake phone.

**Architecture:**
- A Bun/TypeScript codebase (`src/`) with three areas:
  - `src/shared/`: the voice↔agent link protocol and the voice↔phone protocol.
  - `src/agent/`: the agent host.
  - `src/voice/`: the voice service.
- The voice service joins a self-hosted LiveKit room. It runs speech-to-text (STT) and text-to-speech (TTS) through a Python speech worker that reuses the benchmark's engine adapters (`bench.stt`, `bench.tts`).
- The agent host dials out to the voice service over a WebSocket.
- The voice-side logic (ear, mouth, sentence cutting, narration, commands, pairing, LiveKit transport) is ported from sidetone (MIT). Its orchestration is rewritten smaller, because sidetone's `conversation.ts` mixes voice and agent concerns.

**Tech Stack:**
- Bun (latest), TypeScript, `bun test`.
- `@livekit/rtc-node`, and `livekit-server-sdk` for AccessToken.
- LiveKit server via Docker (`livekit/livekit-server`).
- Python 3.12 speech worker using the existing `bench` package (sherpa-onnx 1.13.8, faster-whisper).

**Spec:** [`docs/specs/2026-11-24-phone-voice-agent-design.md`](../../specs/2026-11-24-phone-voice-agent-design.md), milestone 8.2, sections 6.1–6.6 and 6.9.

**Reference material:**
- [`research/sidetone-map.md`](../../../research/sidetone-map.md): the module map, seams, CLI flags, protocols and pairing of crsmithdev/sidetone. Read files from it with `gh api repos/crsmithdev/sidetone/contents/<path> --jq .content | base64 -d`.
- [`docs/findings/background-subagents.md`](../../findings/background-subagents.md): the stream-json events for background jobs.

## Global Constraints

- **Only text crosses the voice↔agent link.** The agent side never handles audio and never loads speech models.
- **Exactly one Claude Code coordinator process per agent host.** Subagents are its own business.
- **Claude Code flags:**
  - Base: `-p --verbose --input-format stream-json --output-format stream-json --include-partial-messages --replay-user-messages --permission-prompt-tool stdio --permission-mode acceptEdits`.
  - Plus `--model <m>`, plus `--effort <e>` unless the effort is `default`, plus `--append-system-prompt <SPOKEN_STYLE>`.
  - Never `--bare`.
  - Resume with `--resume <sessionId>`.
- **Approvals happen in the app** (owner's decision). They stay there until the voice models' accuracy is confirmed.
  - **Forwarding:** every Claude Code permission prompt (`can_use_tool`) is held by the agent host and forwarded to the phone as an approval card with Approve and Deny.
  - **Spoken notice:** the voice speaks `I need your approval on your phone.` once per request.
  - **No voice approval:** nothing spoken approves anything. Saying `continue` while an approval is pending speaks `Please approve that on your phone.`
  - **Fails closed:** a held request times out to deny after **30 minutes**, and the timer keeps running while the phone or the link is down. The deny messages are exactly:
    - when the owner denies: `The owner denied this.`
    - on timeout: `The owner didn't answer in time, so this was denied.`
  - **Re-sending:** pending approvals are re-sent to the phone when it reconnects, and to the voice side when the link reconnects.
- **Network binding:** the voice service and LiveKit bind only to the configured address, which is the Tailscale IP or `127.0.0.1`. Never `0.0.0.0`.
- **Link security:** the link is authenticated by a shared secret in the first message. On a bad secret the server closes with code `4001`; on a version mismatch, `4002`.
- **Speech engines are local only,** via the Python worker. The default engines are `moonshine-base` (STT) and `piper-medium` (TTS) until the benchmark decision. Both are configurable by the engine keys in `bench.stt.ENGINES` and `bench.tts.TTS_ENGINES`.
- **Never read aloud:** fenced code blocks, tables, and lines that are mostly a file path or a command. The voice side strips them before TTS and speaks `It's on your screen.` once per block it removes. The transcript keeps everything.
- **Barge-in:** speech that starts while the voice is speaking stops playback at once (`interruptOnSpeech: true`). Barge-in does not interrupt the agent's turn.
- **Commands:** a spoken command is recognised only when the whole normalised utterance equals one of: `stop`, `new conversation`, `audio off`, `audio on`, `continue`. Normalisation is lowercase, non-`[a-z0-9]` runs become one space, then trim. The phrases come from the reading card. `continue` is recognised but never approves anything in this milestone (see Approvals above).
- **Platforms:** must run on aarch64 and x86-64 Linux. No CUDA-only paths. GPU use is optional and is decided by the engine.
- **Licence:**
  - Files ported from sidetone keep a header comment: `// Portions adapted from crsmithdev/sidetone, Copyright (c) 2026 Chris Smith, MIT License.`
  - `THIRD_PARTY_NOTICES.md` carries sidetone's full MIT licence text.
  - No GPL code.
- **Strip every author-specific item** from ported code: names, the "aleph" registry and handoff code, the custom STT vocabulary, and `voiceInstruction` text.
- **The spoken-style prompt** (`SPOKEN_STYLE`, in `src/agent/prompt.ts`) is exactly:

```
You are talking with the owner through their earbuds. They are away from their desk and usually cannot see a screen. Everything you write is read aloud, except code blocks, tables and file paths, which only appear on their phone.
- Talk like a colleague: conclusion first, and keep the first sentence under twelve words.
- Never read code, diffs, file paths, commands or tables aloud. If they are needed, put them in a code block and say "it's on your screen".
- Keep your own turns short. Hand any work longer than a quick lookup to a subagent running in the background, say in one sentence what you started, and stay available to talk.
- When a background job finishes, report its result in two or three spoken sentences.
- Each message starts with [verbosity: brief|normal|full]. brief means one or two sentences, normal up to five, full as long as needed.
```

## Review Focus

1. **The link drops mid-turn.** For example, the agent host restarts or the laptop sleeps. The voice side must not stay "thinking" forever. Status goes to `agent: "down"`, the voice speaks `I've lost the agent.` once, and the open turn is closed. When the agent reconnects, the voice speaks `The agent is back.` Test in Task 7 (behaviour 6) and Task 9 (end to end).
2. **Claude can't start,** for example because the login expired. The supervisor backs off at 1 s, 2 s, 4 s and so on, capped at 60 s, never in a tight loop. It sends `agent: "crashed"` with the last stderr line. Test in Task 2.
3. **An unprompted turn arrives while the owner is mid-utterance.** For example, a background job finishes. The reply is held until the owner's utterance ends, so the voice never talks over them. Test in Task 7 (behaviour 4).
4. **A nested task's `task_notification`** (one with `parent_task_id`, or with `owned_by_subagent` true) must never end a job or count as one. Test in Task 3.
5. **A reply that is mostly code or a table** speaks only `It's on your screen.`, never the code. Test in Task 6 (`speakable`).
6. **An approval is pending when the phone drops, or the link drops.** The request stays held. It reappears on the phone after the reconnect and is never decided twice. If 30 minutes pass first, it is denied with the timeout message. A late `decide` for an expired or already-decided id is ignored. Test in Task 2 (timeout and double-decide), Task 4 (re-send on link reconnect) and Task 7 (re-send on phone reconnect).

---

### Task 1: Bun project, shared protocols, notices

**Prerequisite (owner):** Bun is installed (`bun --version` prints a version). If it is missing, the implementer stops and reports NEEDS_CONTEXT. Never install it yourself.

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/shared/link.ts`, `src/shared/phone.ts`, `test/shared/link.test.ts`, `test/shared/phone.test.ts`, `THIRD_PARTY_NOTICES.md`
- Modify: `.gitignore` (add `node_modules/`), `README.md` (a "Development" section: `bun install`, `bun test`, `uv sync`)

**Interfaces:**
- Produces `src/shared/link.ts`:
  - `LINK_VERSION = 1`.
  - `type Verbosity = "brief" | "normal" | "full"`.
  - `type Effort = "default" | "low" | "medium" | "high"`.
  - `type AgentToVoice`, a union discriminated on `t`:
    - `{t:"hello"; version:number; secret:string}`
    - `{t:"agent"; state:"starting"|"ready"|"restarting"|"crashed"; detail?:string}`
    - `{t:"turnStart"; turnId:string; origin:"owner"|"agent"}`
    - `{t:"blockStart"; turnId:string; block:number}`
    - `{t:"delta"; turnId:string; block:number; text:string}`
    - `{t:"blockEnd"; turnId:string; block:number}`
    - `{t:"tool"; turnId:string; phase:"start"|"end"; name:string; summary:string}`
    - `{t:"job"; phase:"start"|"end"; id:string; label:string; summary?:string}`
    - `{t:"turnEnd"; turnId:string; ok:boolean; error?:string}`
    - `{t:"approval"; id:string; tool:string; summary:string; detail:string}`. `summary` is one line, for example `Bash: git push origin main`. `detail` holds the tool input as pretty JSON, capped at 4,000 characters.
    - `{t:"approvalDone"; id:string; allow:boolean; by:"owner"|"timeout"}`
  - `type VoiceToAgent`:
    - `{t:"welcome"; version:number}`
    - `{t:"turn"; turnId:string; text:string; verbosity:Verbosity}`
    - `{t:"interrupt"}`
    - `{t:"newConversation"}`
    - `{t:"settings"; model?:string; effort?:Effort}`
    - `{t:"decide"; id:string; allow:boolean}`
  - `encodeLink(m: AgentToVoice | VoiceToAgent): string`.
  - `decodeAgentToVoice(s: string): AgentToVoice` and `decodeVoiceToAgent(s: string): VoiceToAgent`. Both throw `LinkError` on malformed JSON, an unknown `t`, or a missing or mistyped field.
- Produces `src/shared/phone.ts`, the voice↔phone data-channel protocol:
  - `PHONE_PROTOCOL = 1`.
  - `type ToPhone`:
    - `{t:"heard"; text:string}`
    - `{t:"blockStart"|"blockEnd"; turnId:string; block:number}`
    - `{t:"delta"; turnId:string; block:number; text:string}`
    - `{t:"sentence"; turnId:string; index:number; text:string}`
    - `{t:"speaking"; turnId:string; index:number}`
    - `{t:"narration"; text:string}`
    - `{t:"status"; agent:"ready"|"restarting"|"down"; thinking:boolean; jobs:number; audio:boolean}`
    - `{t:"error"; text:string}`
    - `{t:"approval"; id:string; tool:string; summary:string; detail:string; expiresAt:number}`. `expiresAt` is in epoch ms.
    - `{t:"approvalDone"; id:string; allow:boolean; by:"owner"|"timeout"}`
  - `type FromPhone`:
    - `{t:"hello"; protocol:number}`
    - `{t:"mic"; on:boolean}`
    - `{t:"audio"; on:boolean}`
    - `{t:"said"; text:string}`, a typed turn, used by the fake phone and tests.
    - `{t:"decide"; id:string; allow:boolean}`
  - `encodePhone` / `decodeToPhone` / `decodeFromPhone`, with the same error rule as the link codec, throwing `PhoneProtocolError`.
  - `MAX_PHONE_MESSAGE_BYTES = 60000`, from sidetone. `encodePhone` throws if the message is larger.

- [ ] **Step 1: Write failing tests.**
  - Round-trip every message variant through encode and decode.
  - `decodeVoiceToAgent('{"t":"turn","turnId":"a"}')` throws `LinkError` (missing `text`).
  - `decodeAgentToVoice('{"t":"nope"}')` throws.
  - `encodePhone` of a 70,000-character delta throws.
- [ ] **Step 2: Run `bun test test/shared`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** with hand-written field checks. Add no schema-library dependency.
  - `package.json`: `"type":"module"`, a script `"test":"bun test"`, dependencies `@livekit/rtc-node` and `livekit-server-sdk` (latest), and a devDependency `@types/bun`.
  - Run `npm view @livekit/rtc-node optionalDependencies` and record in the report whether a `linux-arm64-gnu` build exists. If none exists, report DONE_WITH_CONCERNS.
- [ ] **Step 4: Run `bun test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: bun project with link and phone protocols`.

### Task 2: Agent host, the supervised coordinator process

**Files:**
- Create: `src/agent/claude.ts`, `src/agent/coordinator.ts`, `src/agent/supervisor.ts`, `src/agent/prompt.ts`, `test/agent/coordinator.test.ts`, `test/agent/supervisor.test.ts`, `test/fixtures/fake-claude.ts`, `test/fixtures/stream/*.ndjson`

**Interfaces:**
- Consumes: `AgentToVoice`, `VoiceToAgent`, `Verbosity`, `Effort` (Task 1).
- Produces:
  - `src/agent/prompt.ts`:
    - `SPOKEN_STYLE: string`, exactly as in Global Constraints.
    - `DENIED_BY_OWNER = "The owner denied this."`.
    - `DENIED_BY_TIMEOUT = "The owner didn't answer in time, so this was denied."`.
    - `withVerbosity(text: string, v: Verbosity): string`, which returns `` `[verbosity: ${v}]\n${text}` ``.
  - `src/agent/claude.ts`:
    - `interface ClaudeProcess { write(obj: object): void; lines: AsyncIterable<any>; stderrTail(): string; exited: Promise<number>; kill(): void }`.
    - `type Spawn = (args: string[], cwd: string) => ClaudeProcess`.
    - `spawnClaude: Spawn`, which uses `Bun.spawn([process.env.TALKATIVE_CLAUDE ?? "claude", ...args])`. The env override lets tests and the end-to-end run use `test/fixtures/fake-claude.ts`.
    - `claudeArgs(o: {model:string; effort:Effort; resume?:string}): string[]`, which builds exactly the flag list in Global Constraints.
  - `src/agent/coordinator.ts`:
    - `class Coordinator`.
    - `constructor(o: {spawn: Spawn; cwd: string; model: string; effort: Effort; emit: (m: AgentToVoice) => void; approvalTimeoutMs?: number; now?: () => number})`. The default `approvalTimeoutMs` is `1_800_000`.
    - Methods: `start(): void`, `turn(turnId: string, text: string, v: Verbosity): void`, `interrupt(): void`, `newConversation(): void`, `settings(model?: string, effort?: Effort): void`, `decide(id: string, allow: boolean): void`.
    - `pendingApprovals(): AgentToVoice[]`, which returns the `approval` messages not yet decided. Task 4 re-sends them after a link reconnect.
    - Getter `sessionId: string | null`.
  - `src/agent/supervisor.ts`:
    - `class Supervisor`.
    - `constructor(o: {start: () => ClaudeProcess; onCrash: (code: number, stderr: string, nextDelayMs: number) => void; sleep?: (ms: number) => Promise<void>})`.
    - `backoffMs(failures: number): number`. It returns `min(1000 * 2 ** (failures - 1), 60000)`, and the failure count resets after 60 s of uptime.

**Behaviour the tests pin.** Use `test/fixtures/fake-claude.ts`, a Bun script that reads stream-json user lines and replays a named NDJSON fixture per turn.
- **Turn input:** `turn("t1", "hi", "brief")` writes `{"type":"user","message":{"role":"user","content":"[verbosity: brief]\nhi"}}`.
- **Block events:** emits `turnStart{turnId:"t1",origin:"owner"}`. Then, from `stream_event` content-block start, delta and stop events, it emits `blockStart` / `delta` / `blockEnd`. A tool-use block emits `tool{phase:"start"}` instead of a text block, and its result emits `tool{phase:"end"}`. The `result` event emits `turnEnd{ok:true}`.
- **Unprompted turns:** assistant output that arrives while no owner turn is open emits `turnStart{origin:"agent", turnId:"agent-<n>"}`.
- **Approvals:** a `control_request` of subtype `can_use_tool` is held. It emits `approval{id: <request_id>, tool, summary, detail}`. Follow sidetone's `protocol.ts` for the exact request and response shapes.
  - `decide(id, true)` answers with an allow `control_response`, passing the original input unchanged, and emits `approvalDone{allow:true, by:"owner"}`.
  - `decide(id, false)` answers with a deny carrying `DENIED_BY_OWNER` and emits `approvalDone{allow:false, by:"owner"}`.
  - After `approvalTimeoutMs` (driven by the injected clock in tests), it answers with a deny carrying `DENIED_BY_TIMEOUT` and emits `approvalDone{allow:false, by:"timeout"}`.
  - A second `decide`, or a `decide` for an unknown or expired id, does nothing (Review Focus 6).
  - A process restart (crash, `newConversation` or `settings`) drops pending approvals and emits `approvalDone{allow:false, by:"timeout"}` for each, because the request they answered no longer exists.
- **Interrupt:** `interrupt()` writes a `control_request` of subtype `interrupt`.
- **New conversation:** `newConversation()` kills the process and restarts it without `--resume`.
- **Settings:** `settings()` restarts the process with `--resume <sessionId>`.
- **Crashes:** a crash restarts with `--resume <sessionId>`, emitting `agent{state:"restarting"}` and then `agent{state:"ready"}` once the `system/init` line arrives. Repeated failures follow `backoffMs` and emit `agent{state:"crashed", detail:<last stderr line>}`.

- [ ] **Step 1: Write the fixtures.** Build them from sidetone's `test/` NDJSON fixtures where suitable, plus hand-written minimal ones.
  - Every `system/init` line must be stripped to `{type, subtype, session_id, model}`. **No cwd, tools, MCP server list, plugins or account fields may appear in a committed fixture.**
- [ ] **Step 2: Write the failing tests** for each behaviour bullet. For approvals, add a `can_use_tool` fixture and cover:
  - allow;
  - deny;
  - timeout with an injected clock at `approvalTimeoutMs`;
  - a second `decide` ignored;
  - an unknown id ignored;
  - `pendingApprovals()` before and after a decision;
  - pending approvals dropped on a restart.

  Also add `backoffMs(1)=1000`, `backoffMs(4)=8000`, `backoffMs(10)=60000`, and the reset after 60 s of uptime (use an injected clock).
- [ ] **Step 3: Run `bun test test/agent`.** Expected: FAIL.
- [ ] **Step 4: Implement.** Port the parsing logic from sidetone's `src/session.ts` and `src/protocol.ts`, adapted to emit `AgentToVoice`, with the licence header. Port `supervisor.ts` the same way.
- [ ] **Step 5: Run `bun test`.** Expected: PASS.
- [ ] **Step 6: Commit** `feat: agent host coordinator with supervisor and spoken-style prompt`.

### Task 3: Background-job tracking

**Files:**
- Create: `src/agent/jobs.ts`, `test/agent/jobs.test.ts`, `test/fixtures/stream/background-*.ndjson`
- Modify: `src/agent/coordinator.ts` (route `system` events through `JobTracker`)

**Interfaces:**
- Consumes: `AgentToVoice` (Task 1), `Coordinator` (Task 2).
- Produces:
  - `class JobTracker { observe(ev: any): AgentToVoice[]; running(): number }`.
  - `observe` maps:
    - `system/task_started` with no `parent_task_id` and `owned_by_subagent` not true → `job{phase:"start", id:task_id, label}`. The label is the event's description field, cut to 80 characters, or `background job` if it has none.
    - `system/task_notification` with no `parent_task_id` and `owned_by_subagent` not true → `job{phase:"end", id, label, summary}`. A notification for an unknown id still ends nothing and emits nothing.
    - Everything else, including nested tasks, → `[]`.
  - `running()` counts started jobs that have not ended.

- [ ] **Step 1: Build sanitised fixtures** from the owner's local `spikes/background-jobs/events-subagent.jsonl` and `events-bash.jsonl`. These files are git-ignored and exist on this machine. Read the exact field names from them.
  - Keep only `task_started`, `task_notification`, `background_tasks_changed`, the assistant and stream events around the unprompted turn, and `result`.
  - Strip every init field as in Task 2. Write them as `test/fixtures/stream/background-subagent.ndjson` and `background-bash.ndjson`.
- [ ] **Step 2: Write the failing tests:**
  - The subagent fixture yields exactly one job start and one job end with the same id. The four nested `local_bash` notifications yield nothing (Review Focus 4).
  - The Bash fixture yields one start and one end.
  - `running()` is 1 mid-fixture and 0 at the end.
  - Replayed through `Coordinator` with the fake claude, the job's unprompted turn emits `turnStart{origin:"agent"}` after the `job{phase:"end"}`.
- [ ] **Step 3: Run `bun test test/agent/jobs.test.ts`.** Expected: FAIL.
- [ ] **Step 4: Implement** and wire it into `Coordinator`.
- [ ] **Step 5: Run `bun test`.** Expected: PASS.
- [ ] **Step 6: Commit** `feat: background-job tracking from stream-json task events`.

### Task 4: The voice↔agent link

**Files:**
- Create: `src/voice/link-server.ts`, `src/agent/link-client.ts`, `test/link.test.ts`

**Interfaces:**
- Consumes: the link codec (Task 1), `Coordinator` (Task 2).
- Produces:
  - `src/voice/link-server.ts`:
    - `class LinkServer`.
    - `constructor(o: {host: string; port: number; secret: string})`.
    - `start(): Promise<void>`, `stop(): void`, `send(m: VoiceToAgent): boolean`, which returns false if no agent is connected.
    - `onMessage(cb: (m: AgentToVoice) => void)`, `onConnection(cb: (connected: boolean) => void)`.
    - It accepts one agent at a time. A newer authenticated connection replaces the older one.
  - `src/agent/link-client.ts`:
    - `class LinkClient`.
    - `constructor(o: {url: string; secret: string; onMessage: (m: VoiceToAgent) => void; onState: (s: "up"|"down") => void; backoff?: (n: number) => number})`.
    - `start(): void`, `send(m: AgentToVoice): void`.
    - While down, `send` buffers `turnEnd` / `job` / `agent` / `approvalDone` messages only, at most 100, and flushes them after `welcome`. `approval` messages are not buffered: `connectAgent` re-sends them from the coordinator instead, so they are never duplicated.
    - It also has `onWelcome(cb: () => void)`.
    - Reconnect delay is 0.5 s, then doubling, capped at 10 s.
  - `connectAgent(coordinator: Coordinator, client: LinkClient): void` wires `turn` / `interrupt` / `newConversation` / `settings` / `decide` to the coordinator, and the coordinator's `emit` to `client.send`. After every `welcome` it re-sends `coordinator.pendingApprovals()`.

- [ ] **Step 1: Write the failing tests,** in-process with `Bun.serve` on port 0:
  - Handshake with welcome.
  - A wrong secret closes with 4001 and the client keeps retrying without throwing.
  - A version mismatch closes with 4002.
  - Messages flow both ways.
  - Killing the server makes the client reconnect when it restarts, and buffered `job` messages arrive after the reconnect.
  - A second authenticated client replaces the first.
  - With a `Coordinator` on fake-claude: an `approval` pending across a link drop reaches the server again after the reconnect, exactly once. A `decide` sent from the server resolves it (Review Focus 6).
- [ ] **Step 2: Run `bun test test/link.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** The server binds only `o.host`.
- [ ] **Step 4: Run `bun test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: authenticated voice-agent link with reconnect`.

### Task 5: Python speech worker and its TypeScript client

**Files:**
- Create: `bench/worker.py`, `tests/test_worker.py`, `src/voice/speech.ts`, `test/voice/speech.test.ts`, `test/fixtures/fake-worker.ts`

**Interfaces:**
- Produces:
  - `bench/worker.py`, run as `python -m bench.worker --stt <key> --tts <key>`. It reads JSON lines on stdin and writes JSON lines on stdout. It loads both engines at start and does one warm-up each, then prints `{"ready":true,"stt":key,"tts":key}`.
    - Request `{"id":n,"op":"stt","pcm16k":"<base64 int16 LE>"}` → `{"id":n,"text":str}`.
    - Request `{"id":n,"op":"tts","text":str}` → `{"id":n,"pcm":"<base64 int16 LE>","rate":int}`.
    - An error → `{"id":n,"error":"<Exc>: <msg>"}`. The worker keeps running after errors.
    - It needs a new `bench.tts` method `synth(text) -> tuple[np.ndarray, int]`, returning the whole utterance. Add it to `SherpaTts`.
  - `src/voice/speech.ts`:
    - `class SpeechWorker`.
    - `constructor(o: {python: string; stt: string; tts: string; memoryMaxMb?: number; cwd: string})`.
    - `start(): Promise<void>`, which resolves on `ready`.
    - `transcribe(pcm16k: Int16Array): Promise<string>`.
    - `synth(text: string): Promise<Int16Array>`, which returns 48 kHz mono, resampled linearly from the engine's rate.
    - Requests are serialised in order, and replies are matched by id.
    - When `memoryMaxMb` is set and `systemd-run` exists, it launches as `systemd-run --user --scope -q -p MemoryMax=<n>M <python> -m bench.worker …`. Otherwise it launches directly and logs one warning.
    - A worker that exits rejects pending requests and is restarted once on the next call.
  - `resample(pcm: Int16Array, from: number, to: number): Int16Array`, linear.

- [ ] **Step 1: Write the failing tests.**
  - Python, with fake engines injected by monkeypatching `ENGINES` and `TTS_ENGINES`: the stt and tts round trip, an error reply keeps the worker alive, and the ready line is printed.
  - TypeScript, against `test/fixtures/fake-worker.ts`:
    - Ordering of 5 concurrent requests.
    - A rejection when the worker exits mid-request, then a restart on the next call.
    - `resample` of a 16 kHz 1 s buffer to 48 kHz gives 48,000 samples, and preserves a sine's RMS within 2%.
- [ ] **Step 2: Run `uv run pytest tests/test_worker.py -q && bun test test/voice/speech.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both suites in full.** Also run one real smoke: `SpeechWorker` with `moonshine-base` and `piper-medium` transcribing `tests/fixtures/stop.wav` and synthesising one sentence. Record the timings in the report.
- [ ] **Step 5: Commit** `feat: speech worker over JSON lines with a memory cap`.

### Task 6: Ear, sentences and commands (ported)

**Files:**
- Create: `src/voice/ear.ts`, `src/voice/sentences.ts`, `src/voice/commands.ts`, `src/voice/speakable.ts`, `test/voice/ear.test.ts`, `test/voice/sentences.test.ts`, `test/voice/commands.test.ts`, `test/voice/speakable.test.ts`

**Interfaces:**
- Produces:
  - `src/voice/ear.ts`, ported from sidetone `src/ear.ts`:
    - `class Ear`.
    - `constructor(o: EarSettings & {onUtterance: (pcm16k: Int16Array) => void; onSpeechStart: () => void; onBargeIn: () => void})`.
    - `push(frame48k: Int16Array): void`.
    - `speaking: boolean` is a setter the mouth uses to signal playback.
    - `EarSettings` defaults are sidetone's values: `endOfTurnPauseMs: 1500`, `earlyTranscribeMs: 400`, `bargeInLevel: 0.05`, `bargeInMs: 400`, `bargeInGapMs: 200`, `minSpeechPeak: 0.15`, `speechLevel: 0.02`, `speechMs: 50`, `interruptOnSpeech: true`.
    - Utterances are delivered as 16 kHz mono.
  - `src/voice/sentences.ts`, ported from sidetone: `class SentenceCollector { push(delta: string): string[]; flush(): string[] }`.
  - `src/voice/commands.ts`: `type Command = "stop"|"new conversation"|"audio off"|"audio on"|"continue"`, and `matchCommand(utterance: string): Command | null`, which uses the exact-normalised-match rule in Global Constraints.
  - `src/voice/speakable.ts`: `speakable(blockText: string): {speak: string; removed: number}`.
    - It removes fenced code blocks, Markdown tables, and lines where at least 60% of the characters are inside a path or a command token (`/`, `\`, `` ` ``, or `--flag`).
    - For each removed run it appends `It's on your screen.` once, and collapses runs of that sentence into one.

- [ ] **Step 1: Write the failing tests.**
  - Port sidetone's ear and sentence tests, minus anything author-specific, with synthetic frames.
  - `matchCommand("Stop.")` is `"stop"`.
  - `matchCommand("stop the build")` is `null`.
  - `matchCommand("New conversation!")` is `"new conversation"`.
  - `speakable("Done.\n```ts\nx()\n```\nAll good.")` gives `"Done. It's on your screen. All good."` with `removed: 1`.
  - A table-only block gives `"It's on your screen."` (Review Focus 5).
  - A barge-in after 400 ms of speech while `speaking` calls `onBargeIn` once.
- [ ] **Step 2: Run `bun test test/voice`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Each port carries the licence header.
- [ ] **Step 4: Run `bun test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: ear, sentence cutter, commands and speakable filter`.

### Task 7: Voice conversation orchestrator

**Files:**
- Create: `src/voice/mouth.ts`, `src/voice/conversation.ts`, `test/voice/conversation.test.ts`, `test/voice/harness.ts`

**Interfaces:**
- Consumes: `Ear`, `SentenceCollector`, `matchCommand`, `speakable` (Task 6); `SpeechWorker` as an interface (Task 5); the link and phone types (Task 1).
- Produces:
  - `interface Speaker { play(pcm48k: Int16Array): Promise<void>; stop(): void }`.
  - `interface Stt { transcribe(pcm16k: Int16Array): Promise<string> }`.
  - `interface Tts { synth(text: string): Promise<Int16Array> }`.
  - `interface AgentPort { send(m: VoiceToAgent): boolean }`.
  - `interface PhonePort { send(m: ToPhone): void }`.
  - `class Mouth`, ported from sidetone `src/mouth.ts` without hold music:
    - `say(turnId: string, index: number, text: string): void` queues a sentence. Synthesis of the next sentence overlaps playback of the current one.
    - `stop(): void` drops the queue and stops the speaker.
    - `busy: boolean`.
    - It emits `speaking` to the phone as each sentence starts.
  - `class VoiceConversation`.
    - `constructor(o: {stt: Stt; tts: Tts; speaker: Speaker; agent: AgentPort; phone: PhonePort; verbosity?: Verbosity; ear?: Partial<EarSettings>})`.
    - Methods: `onFrame(frame48k: Int16Array)`, `onAgent(m: AgentToVoice)`, `onAgentConnection(up: boolean)`, `onPhone(m: FromPhone)`.

**Behaviour the tests pin.** Use `test/voice/harness.ts`, with fake Stt, Tts, Speaker, AgentPort and PhonePort and synthetic frames.
1. **An utterance ends.** STT runs and the phone gets `heard{text}`.
   - If the text matches a command, the command acts:
     - `stop` → `mouth.stop()` plus `agent.send({t:"interrupt"})`.
     - `new conversation` → `newConversation` plus speak `Starting a new conversation.`
     - `audio off` / `audio on` → toggle audio and send `status`.
     - `continue` → speak `Please approve that on your phone.` if an approval is pending. Otherwise speak `There's nothing waiting for approval.` It never approves anything.
   - Otherwise it sends `turn{turnId:"o-<n>", text, verbosity}`. A `said` message from the phone is treated the same as an utterance, without STT.
2. **Agent deltas** go to the phone as they arrive. They also go through the `SentenceCollector` and then `speakable`, and each speakable sentence goes to `mouth.say`. If audio is off, nothing is spoken but the phone still gets everything.
3. **Barge-in** calls `mouth.stop()` and does not interrupt the turn. The rest of that turn's sentences are not spoken but stay on the phone.
4. **An unprompted turn** (`origin:"agent"`) that arrives while the ear is mid-utterance is held until that utterance ends, then spoken (Review Focus 3).
5. **Status:**
   - `tool{start}` sends `narration{text: "<name>: <summary>"}` to the phone. It is not spoken.
   - `job` events keep a running count.
   - `status{thinking: owner turn open, jobs: n}` is sent whenever either changes.
6. **The link drops** (`onAgentConnection(false)`): close any open turn locally, send `status{agent:"down"}`, and speak `I've lost the agent.` once. On the way back up, speak `The agent is back.` and send `status{agent:"ready"}` (Review Focus 1).
   - `agent{state:"restarting"}` → speak `The agent is restarting.`
   - `agent{state:"crashed"}` → speak `The agent can't start.`
   - While the agent is down, a turn is not sent. Instead the voice speaks `The agent isn't connected.`
7. **The first sentence of each reply** reaches `tts.synth` before that turn's `turnEnd`. That is the streaming check.
8. **Approvals in the app:**
   - `approval` from the agent is stored as pending and sent to the phone as `approval{…, expiresAt}`. The voice speaks `I need your approval on your phone.` once per id, held like an unprompted turn if the owner is mid-utterance.
   - `decide{id, allow}` from the phone is forwarded to the agent only if that id is pending. Otherwise it is ignored.
   - `approvalDone` from the agent clears the pending entry and goes to the phone. It speaks `Approved.` or `Denied.` only for `by:"owner"`, and `That approval timed out.` for `by:"timeout"`.
   - A phone `hello` re-sends every pending approval.
   - If the link drops, pending approvals stay listed on the phone, because the agent still holds them. The agent's re-send after the reconnect replaces them by id, with no duplicates (Review Focus 6).

- [ ] **Step 1: Write the failing tests,** one per numbered behaviour, plus a mixed scenario that combines barge-in and then an unprompted job report.
- [ ] **Step 2: Run `bun test test/voice/conversation.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `conversation.ts` focused on orchestration. If it grows past about 400 lines, report DONE_WITH_CONCERNS rather than splitting it on your own.
- [ ] **Step 4: Run `bun test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: voice conversation orchestrator`.

### Task 8: LiveKit room, pairing, config and entrypoints

**Files:**
- Create: `src/voice/room.ts`, `src/voice/pairing.ts`, `src/voice/livekit.ts`, `src/config.ts`, `src/main.ts`, `test/voice/pairing.test.ts`, `test/config.test.ts`, `deploy/talkative-voice.service`, `deploy/talkative-agent.service`, `deploy/README.md`

**Interfaces:**
- Produces:
  - `src/config.ts`:
    - `type Config`, with this shape:
      ```
      {
        linkSecret: string;
        voice: {
          bind: string; pairPort: number; linkPort: number;
          livekitUrl: string; room: string;
          python: string; stt: string; tts: string; memoryMaxMb: number;
          verbosity: Verbosity;
        };
        agent: { voiceUrl: string; project: string; model: string; effort: Effort };
      }
      ```
    - `loadConfig(path = "~/.talkative/config.json"): Config`, which validates and throws on a missing field, or on `bind` = `0.0.0.0`.
    - `initConfig(o: {bind: string; project: string}): Config`. It writes `config.json` (mode 600) with a random 32-byte hex `linkSecret`. Its defaults:
      - `pairPort` 7890, `linkPort` 7891, `livekitUrl` `ws://<bind>:7880`, `room` `talkative`;
      - `python` `<repo>/.venv/bin/python`;
      - `stt` `moonshine-base`, `tts` `piper-medium`, `memoryMaxMb` 3072;
      - `verbosity` `normal`, `model` `sonnet`, `effort` `default`;
      - `voiceUrl` `ws://<bind>:7891`.
  - `src/voice/livekit.ts`: `writeLivekitConfig(bind: string): {path: string; dockerCommand: string}`.
    - Ported from sidetone: `~/.talkative/livekit.yaml` with a generated API key and secret in `~/.talkative/keys.json` (mode 600), port 7880, TCP 7881, UDP 50000–50019, and `node_ip: <bind>`.
    - The docker command uses `--network host` and the `livekit/livekit-server` image.
  - `src/voice/pairing.ts`, ported from sidetone `keys.ts` and `device.ts`:
    - `class Pairing`.
    - `constructor(o: {bind: string; port: number; apiKey: string; apiSecret: string; livekitUrl: string; room: string; words?: string[]})`.
    - `code: string` is three words, regenerated at start.
    - `start()` serves `POST /pair {code}` → `{url, token}`. The token is a 30-day LiveKit AccessToken for identity `phone`, with room join, publish and subscribe.
    - Five wrong codes in 60 s locks pairing for 60 s.
  - `src/voice/room.ts`: `class Room`, ported from sidetone `transport.ts`.
    - `constructor(o: {url: string; token: string})`.
    - `join(): Promise<void>`, `onFrame(cb: (frame48k: Int16Array) => void)`, `speaker: Speaker`, `phone: PhonePort`, `onPhone(cb: (m: FromPhone) => void)`.
    - It subscribes to the `phone` identity's audio, publishes one audio track, and uses the reliable data channel for `ToPhone` and `FromPhone`.
  - `src/main.ts`: `bun src/main.ts <init|livekit|voice|agent|code>`.
    - `init --bind <ip> --project <dir>` creates the config.
    - `livekit` writes the LiveKit config and prints the docker command.
    - `voice` starts LinkServer, SpeechWorker, Pairing, Room and VoiceConversation, and prints the pairing code.
    - `agent` starts Coordinator, LinkClient and `connectAgent`. It reads the optional env var `TALKATIVE_APPROVAL_TIMEOUT_MS` (an integer, used for tests) as the coordinator's `approvalTimeoutMs`.
    - `code` prints the current pairing code from the running voice service, through a local-only file `~/.talkative/code` (mode 600).
  - `deploy/*.service`: systemd user units for `voice` and `agent`. `deploy/README.md` covers:
    - the split shape: voice plus LiveKit on the server, agent on the laptop, with `bind` set to the server's Tailscale IP;
    - the single-machine shape: everything on one host, with `bind` set to the host's Tailscale IP or `127.0.0.1`.

- [ ] **Step 1: Write the failing tests.**
  - Config: validation errors, refusal of `0.0.0.0`, mode 600 on `config.json` and `keys.json`.
  - Pairing over HTTP on port 0:
    - A right code returns a token whose decoded grants contain room `talkative` and identity `phone`.
    - A wrong code returns 403.
    - The lockout starts after 5 failures.
    - The server binds only `o.bind`.
- [ ] **Step 2: Run `bun test test/voice/pairing.test.ts test/config.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** `Room` is covered by Task 9's end-to-end test, not by unit tests.
- [ ] **Step 4: Run `bun test`.** Expected: PASS. Also run `bun src/main.ts init --bind 127.0.0.1 --project /tmp/x` and `bun src/main.ts livekit` with `HOME` pointed at a temporary directory, and show the output.
- [ ] **Step 5: Commit** `feat: livekit room, pairing, config and entrypoints for both shapes`.

### Task 9: Fake phone and the end-to-end test

**Files:**
- Create: `scripts/fake-phone.ts`, `test/e2e/e2e.test.ts`, `test/e2e/README.md`

**Interfaces:**
- Consumes: everything above. `test/fixtures/fake-claude.ts` gets a fixture whose every turn answers `"Two short sentences. The second one is here."`.
- Produces:
  - `scripts/fake-phone.ts --pair <http://host:7890> --code <words> --say <wav> [--say <wav> ...] [--text <typed>] [--decide allow|deny|none]`. `--decide` answers every `approval` message automatically. The default is `none`.
    - It pairs, then joins the room as `phone`.
    - It plays each WAV as 48 kHz 20 ms frames in real time, followed by 2 s of silence.
    - It records the incoming audio and the `ToPhone` messages.
    - It prints JSON lines `{event, t}`, where t is seconds since the end of the utterance it just played. The events are `heard`, `firstAudio`, `sentence` and `status`.
  - The end-to-end test, gated on `TALKATIVE_E2E=1`. It needs Docker, models and ffmpeg, and is skipped otherwise.
    - It starts LiveKit in Docker on 127.0.0.1 and runs `init` in a temporary `HOME`.
    - It starts `voice` and `agent`, with the agent using fake-claude via the `TALKATIVE_CLAUDE` env var (the override comes from Task 2).
    - It runs the fake phone with `tests/fixtures/sentence.wav`.

**Assertions:**
- `heard` text normalises to contain `livekit` and `oracle`, or `live kit`.
- `firstAudio` arrives within 10 s.
- Two `sentence` messages arrive.
- Then the agent process is killed:
  - `status{agent:"down"}` arrives within 5 s.
  - After the agent restarts, `status{agent:"ready"}` arrives.
- A second run with `--say tests/fixtures/stop.wav` during a reply shows playback stopping. No `sentence` audio arrives after the barge-in.
- An approval run, where fake-claude has a turn fixture that emits a `can_use_tool` request:
  - The fake phone with `--decide allow` sees `approval`, sends `decide`, and then sees `approvalDone{allow:true, by:"owner"}`.
  - The fake claude receives an allow `control_response`.
  - With `--decide none`, the approval stays pending until the test's shortened `approvalTimeoutMs` (env `TALKATIVE_APPROVAL_TIMEOUT_MS=3000`, read by `main.ts agent`) ends it with `by:"timeout"`.

- [ ] **Step 1: Write the end-to-end test,** and confirm it skips without `TALKATIVE_E2E`.
- [ ] **Step 2: Implement the fake phone,** ported from sidetone `scripts/fake-phone.ts` and simplified, with the licence header.
- [ ] **Step 3: Run `TALKATIVE_E2E=1 bun test test/e2e`** on this laptop. Expected: PASS. Record the measured `firstAudio` times.
  - If LiveKit's Docker image or `@livekit/rtc-node` fails on this machine, report BLOCKED with the error.
- [ ] **Step 4: One real-Claude smoke, by hand.** Run `agent` with real `claude` against a scratch project directory, then send `--text "What is two plus two?"`. Record the round trip.

  Then send `--text "Start a background subagent that runs the shell command 'date' and reports the output."` with `--decide allow`. Record whether the **subagent's** Bash permission request reaches the phone as an `approval`. If it doesn't, report DONE_WITH_CONCERNS, because subagent approvals would then bypass the app.

  This costs a few cents of the owner's usage, so run each step once.
- [ ] **Step 5: Commit** `test: fake phone and end-to-end voice-agent test`.

### Task 10: Split shape on the Oracle server (owner-gated)

This task needs the owner's shell access to the Oracle box, which must already be on Tailscale. It is not dispatched to a subagent.

- [ ] **Step 1: On Oracle,** clone the repo, then:
  - `uv sync`
  - `scripts/fetch_models.sh`
  - `bun install`
  - `bun src/main.ts init --bind <oracle-tailscale-ip> --project /unused`
  - `bun src/main.ts livekit`, and run the printed docker command.
  - Start the `voice` unit.
- [ ] **Step 2: On the laptop,** set `agent.voiceUrl` to `ws://<oracle-tailscale-ip>:7891` with the same `linkSecret`, and start `agent`.
- [ ] **Step 3: From the laptop,** run the fake phone against Oracle with `sentence.wav`. Record `firstAudio` over Tailscale in `docs/bench/split-shape-smoke.md`.
- [ ] **Step 4: Commit** `docs: split-shape smoke on the Oracle server`.

---

## Not in this plan

These are later plans, per the spec:
- the iOS app (spec 8.3);
- spoken approval with "continue", enabled only once the benchmark and real use confirm recognition accuracy (in-app approval is in this plan);
- what-you-missed after dropouts, cues, and the memory guard (spec 8.4);
- the approval card UI in the iOS app (spec 8.3), which consumes the `approval`, `approvalDone` and `decide` phone messages defined here.
- project switching (spec 6.3, last bullet);
- a full replay of everything that happened while the link was down (spec 6.3 log, 6.7 what-you-missed); this plan only buffers `turnEnd`, `job` and `agent` messages;
- Smart Turn end-of-turn detection, and a neural VAD for gym noise (after the owner's benchmark and first real use).
