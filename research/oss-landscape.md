# OSS landscape: phone-to-coding-agent two-way voice, self-hosted

Recon date: 2026-11-24. Method: `gh api` / `gh search` against GitHub (README, source tree, selected source files, workflow files) and code.claude.com docs. Nothing cloned or executed.

Legend: **[READ]** = seen in source/docs text. **[INFERRED]** = my reasoning from what I read. **[UNVERIFIED]** = not checked or could not be checked.

---

## 1. slopus/happy
URL: https://github.com/slopus/happy

**What it is.** Phone app plus `happy` CLI that wraps Claude Code / Codex (README now also lists Grok, Gemini, OpenCode, ACP agents), with an E2E-encrypted relay server. 24.8k stars. [READ]

**Licence.** MIT. [READ, GitHub licence metadata]
**Activity.** Very active. Last commit 2026-11-22, repo pushed 2026-11-24. [READ]

**Repo layout (monorepo, `packages/`).** [READ] `happy-ios` (native Swift/UIKit), `happy-android` (native Kotlin/Compose), `happy-cli`, `happy-server` (private, hosted backend), `happy-server-self-host` (publishing shell for self-hosting), `happy-server-rs` (Rust port, compat layer), `happy-wire`, `happy-push-server` (Cloudflare Worker for APNs/FCM), `happy-i18n`.
- **The mobile app is no longer React Native/Expo in this repo.** README: "native Swift/UIKit iOS app", "native Kotlin/Jetpack Compose Android app". [READ] The older Expo-era docs are stale: `docs/voice-architecture.md` still names `RealtimeSession.tsx`, `voiceHooks.ts`, `realtimeClientTools.ts`, but a code search for ElevenLabs in the repo returns no `.tsx` files, only Swift/Kotlin/Rust/TS-server files. [READ search results; whether an Expo app lives in another repo is UNVERIFIED]
- Desktop app and "Happy Agent" runtime live in separate repos (`slopus/happy-desktop`, `slopus/happy-agent`). [READ README table]

**Voice implementation (concrete).** [READ]
- `docs/agent-voice-call.md`: the voice button starts a call with a **hosted ElevenLabs Conversational AI agent, connected by a public agent ID** baked into the build (`HAPPY_CALL_AGENT_V3_ID`). "The audio, the system prompt, the context the agent reads and its four client tools all live on the phone." No Happy service mints a token for this path.
- Code: iOS `packages/happy-ios/Sources/HappyUI/Call/ElevenLabsConversation.swift`, `ElevenLabsCallConnection.swift`, `Sources/HappyCore/Call/{CallState,CallGrant,...}.swift`. Android `packages/happy-android/app/src/main/kotlin/com/slopus/happy/call/ElevenLabsCallConnection.kt`.
- **Voice in relay sessions (the Claude Code bridge) is switched off in both apps** (Android `VoiceEngine(enabled = false)`; iOS `LegacyVoice`, debug flag `HAPPY_RELAY_VOICE=1`). Voice is currently only for "Happy Agent connections". [READ in agent-voice-call.md]
- Older design (`docs/voice-architecture.md`): ElevenLabs `useConversation` hook; `sendContextualUpdate()` for silent context injection, `sendTextMessage()` to trigger a turn, prompts queued while anyone is speaking, VAD-score-derived `realtimeMode`; two client tools `messageClaudeCode` (-> `sync.sendMessage(sessionId, msg)`) and `processPermissionRequest` (allow/deny). Server side `packages/happy-server/sources/app/api/routes/voiceRoutes.ts` calls `api.elevenlabs.io/v1/convai` to mint tokens and gate usage. `docs/paid-voice.md`/RevenueCat paywall with local free-time ledger. [READ]
- `docs/3dparty.md` lists ElevenLabs, RevenueCat, PostHog as third parties. [READ]

**Can it be swapped for local Whisper + Piper/Kokoro?** [INFERRED from the above]
- Not an endpoint swap. ElevenLabs Conversational AI is a bundled STT + LLM + TTS + turn-taking agent consumed through its client SDK. There is no OpenAI-compatible URL to repoint. You would have to re-implement the call loop (capture, VAD, STT, a *separate* LLM to hold the voice persona, TTS, barge-in, context/tool plumbing) **twice** (Swift and Kotlin), or in a shared layer that does not exist today.
- Also: the context dump (session history, permission requests) is sent to ElevenLabs. That breaks the "no third-party cloud" requirement for content, not just audio.
- The design ideas (context channel vs. prompt channel, batching while speaking, two tools) are the reusable part.

**CLI wrapping Claude Code.** [READ]
- `packages/happy-cli/src/claude/`: `claudeLocal.ts` (spawns the real `claude` via `cross-spawn`, terminal passthrough; there is no PTY library import in the lines I saw), `claudeRemote.ts` + `sdk/query.ts` (a vendored/own Agent-SDK-style `query()` over a `PushableAsyncIterable` of user messages, with `canCallTool` permission callback), `loop.ts`, `session.ts`. `sdk/query.ts` tags the spawned Claude with a custom entrypoint env. Switch local <-> remote mode on phone input. Daemon (`src/daemon`) spawns sessions and syncs machine state. Docs: `docs/cli-architecture.md`. [Exact flags used in query.ts not extracted; UNVERIFIED whether it is literally `--input-format stream-json` though that is how the SDK transport works.]

**Relay + E2E.** [READ `docs/encryption.md`, `happy-server-self-host/README.md`]
- Client-side encryption; server stores opaque blobs (Postgres) and is meant to be blind. Two variants: legacy NaCl secretbox (XSalsa20-Poly1305) and per-session/per-machine AES-256-GCM data keys wrapped with `tweetnacl.box`. Keys in `~/.happy/access.key`. Transport: HTTP + Socket.IO.
- **Self-hostable:** `npm i -g happy happy-server-self-host && happy server` runs the relay with embedded PGlite and local filesystem uploads (no Postgres/Redis/S3). The CLI writes `settings.serverUrl` to point at it. Native apps need a build that targets your server URL [INFERRED; App Store builds point at the hosted server; how custom server URLs are entered in the app is UNVERIFIED].
- Push notifications go through Cloudflare Worker `happy-push-server` (third party for notification metadata). [READ]

**Reuse verdict: borrow ideas + possibly reuse relay/CLI pairing.** Do not try to swap its voice: it is a hosted-agent integration baked into two native clients. If the project wants Happy's pairing/E2E/relay, fork `happy-cli` + `happy-server-self-host` and write a new voice client; but you inherit a large, fast-moving native codebase.

---

## 2. mbailey/voicemode
URL: https://github.com/mbailey/voicemode

**What it is.** MCP server + Claude Code plugin for voice conversations using the *host machine's* mic/speakers. 1.5k stars. v9.1.0. [READ]
**Licence.** MIT. **Activity.** Last commit 2026-11-22. [READ]

**Architecture.** [READ] Python package `voice_mode/` with `server.py`, `tools/converse.py` (the main tool), `tools/whisper/`, `tools/kokoro/`, `tools/mlx_audio/`, `audio_player.py`, `_sounddevice.py` (local audio I/O via PortAudio/sounddevice), `streaming.py`, `providers.py`/`provider_discovery.py`, `simple_failover.py`, `conch*.py` (arbitration so only one agent speaks), `serve_middleware.py`, `control_channel.py`. Claude Code plugin in `.claude-plugin/`, `.mcp.json`.
- **Pluggable OpenAI-compatible endpoints: yes.** `config.py` has `VOICEMODE_TTS_BASE_URLS` (default `http://127.0.0.1:8880/v1,https://api.openai.com/v1`) and `VOICEMODE_STT_BASE_URLS` (default `http://127.0.0.1:2022/v1,...`), failover list, per-endpoint model overrides. Local services are whisper.cpp and Kokoro (Kokoro-FastAPI style) exposing the OpenAI API. Cloud OpenAI is default fallback, so set base URLs explicitly for "no cloud".
- **Network exposure:** `voicemode serve` runs it as an HTTP MCP server (`http://127.0.0.1:8765/mcp`, IP allowlist + bearer token middleware, Tailscale Funnel docs for Claude.ai). [READ `docs/guides/serve-configuration.md`] This exposes the **MCP tools** remotely. The mic/speaker still belong to the machine running the server [INFERRED], so it does not give a phone mic. **LiveKit:** only in `docs/.archive/` (archived design docs), i.e. dropped. [READ file paths; contents not read]
- README footer: "Session Kit" (sessionkit/sessionkit, AGPL-3.0, macOS only, phone line via Delta Chat). [READ] Not local-first on a phone in the sense needed here: Delta Chat relays via mail servers [INFERRED], macOS only.

**Reuse verdict: borrow ideas / reuse components.** Its OpenAI-compatible STT/TTS client + failover logic and the "converse" tool semantics are directly useful; the architecture (agent calls a `converse` tool that blocks on local mic) is wrong for a phone.

---

## 3. agent-sh/parlar
URL: https://github.com/agent-sh/parlar

**What it is.** Rust voice-conversation mode for Claude Code, Codex, Muse, **local-only on the PC mic/speaker**. 3 stars, created 2026-10-01. [READ]
**Licence.** MIT OR Apache-2.0 (README badge; GitHub shows Apache-2.0, `LICENSE-APACHE` and `LICENSE-MIT` both present). **Activity.** Last commit 2026-11-23. [READ]

**Architecture.** [READ] Crates: `parlard` (daemon: `aec.rs`, `audio.rs`, `vad.rs`, `turn.rs`, `stt.rs`, `speak.rs`, `listen.rs`, `openai.rs`, `vocab.rs`, ...), `parlar` (CLI), `parlar-moonshine`, `parlar-overlay`; `plugin/{claude,codex,muse}`; GNOME shell indicator. Pipeline: PipeWire audio -> WebRTC AEC3 (sonora) -> Silero VAD -> Phonon-2 (ONNX) STT -> Smart Turn v3.2 end-of-turn -> Kokoro-82M TTS sentence by sentence. Optional OpenAI-compatible API for STT/TTS with local fallback. Linux x86_64 and **aarch64** prebuilt binaries. Runs on CPU.
- **Hook mechanism (best-documented in this survey):** "a harness plugin, not a terminal wrapper": an MCP server plus hooks. A background **Stop hook wakes an idle session**; a hook after each tool call (PostToolUse) injects your speech mid-turn; a spoken "stop" blocks the next tool call; a `say` tool for speech out. Also a function-hooks module (`plugin/claude/hooks/strip.tsx`) that uses an early-access Claude Code UI API (run on Claude Code 2.1.287). [READ README]
- Audio path is entirely local to the PC; no phone/remote client. [READ]

**Reuse verdict: borrow ideas (strong).** Its Stop-hook wake + PostToolUse injection + blocking-stop pattern is the cleanest "talk to a running interactive session" design found. Turn-taking stack (Silero + Smart Turn + AEC) and ARM64 builds are directly relevant. Not usable for phone as-is; could be forked if the phone client terminates audio and forwards PCM to `parlard`-like engine [INFERRED].

---

## 4. jjacke13/claude-talk
URL: https://github.com/jjacke13/claude-talk

**What it is.** Bun/TypeScript Claude Code plugin; hold-to-talk (evdev key) or trained wake word; whisper.cpp in, Piper out; local mic/speaker via `pw-record`/`pw-play`. 0 stars, created 2026-09-13, last commit 2026-10-06. [READ]
**Licence.** **None declared** (GitHub `licenseInfo: null`; no LICENSE file in root listing). Treat as all-rights-reserved. [READ]

**Architecture.** [READ] `server.ts` (MCP server, a Claude Code **channel**: speech arrives as `<channel source="plugin:talk:talk">` events; run with `--dangerously-load-development-channels`), `voice.ts`, `talk.ts`, `hold.ts`, `wake.ts` (openwakeword), `ui.ts/ui.html` (orb page via SSE), `hooks/`, `bin/speak-last` (Stop hook reads `last_assistant_message`/hook JSON), `speak` MCP tool for mid-turn narration; `TALK_REPLY=voice` makes Claude answer only via `speak`; code blocks/tables never read aloud; config has `stt <url>` option (remote STT). Hook + channel + MCP combination.

**Reuse verdict: borrow ideas.** Useful as a minimal reference for using the Channels mechanism for inbound speech and a `speak` tool for outbound; unlicensed, tiny, local-only.

---

## 5. agjs/voicebox
URL: https://github.com/agjs/voicebox

**What it is.** Self-hosted OpenAI-compatible speech server: faster-whisper STT + Piper (default) or Kokoro TTS. 39 stars, v0.2.16. [READ]
**Licence.** MIT. **Activity.** Last commit 2026-08-12 (3.5 months stale as of recon). [READ]

**API surface.** [READ README, tree: `src/voicebox/{app,config,stt,tts,tts_piper,wav}.py`]
- `GET /v1/models`, `POST /v1/audio/transcriptions` (supports `verbose_json` segment timestamps), `POST /v1/audio/speech` (`voice`, `speed` 0.25-4.0, `response_format`). `GET /health` unauthenticated.
- **Streaming:** TTS `pcm` response is streamed (16-bit mono, format in `X-Audio-*` headers); `wav` is not. **STT is request/response only** (no streaming/WebSocket) [INFERRED: none documented].
- Auth: `VOICEBOX_API_KEY` bearer; refuses non-loopback bind without key unless `VOICEBOX_ALLOW_INSECURE_BIND=true`. Piper voices limited to 3 baked ids.
- **Docker/ARM64:** published image workflows build **`linux/amd64` only** (`platforms: linux/amd64` in `publish-image.yml`/`image-smoke.yml`). Optional `-cuda` image. No ARM64 image; a local `docker build` on ARM might work but is **UNVERIFIED** (deps: faster-whisper/ctranslate2, piper, onnxruntime, Python 3.11 only).
- Includes `clients/voice-chat` (mic loop against any OpenAI-compatible LLM) and `clients/claude-code` (Stop-hook TTS + push-to-talk dictation). [READ README]

**Reuse verdict: reuse as a reference / or replace.** Fine as a quick STT/TTS backend on the laptop (CUDA image), but for a 4-core ARM box prefer `speaches-ai/speaches` (MIT, very active) or `remsky/Kokoro-FastAPI` + whisper.cpp server; voicebox is a thin, one-maintainer wrapper with amd64-only images.

---

## 6. Claude Code integration points (official docs)

| Mechanism | What it gives | Fit for long-lived bidirectional bridge |
|---|---|---|
| **Agent SDK streaming input** (TS: async generator of `SDKUserMessage` into `query()`; Python: `ClaudeSDKClient`) https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode | Persistent session; send many messages; messages sent mid-turn reach Claude after current tool calls (with optional `priority`); `interrupt()`; change model/permission mode mid-session; image attachments; `canUseTool` approval callback; resume by session id | **Best supported.** But this is a *headless* session you own, not the user's already-open interactive TUI. |
| **`claude -p --input-format stream-json --output-format stream-json`** (https://code.claude.com/docs/en/headless) | Same protocol the SDK uses over stdio; `--include-partial-messages` token deltas; `--resume <id>`; `--bare` recommended for scripted calls (note: requires API-key auth, skips hooks/plugins/MCP/CLAUDE.md unless passed); `system/init` capabilities; permission denials surfaced in stream. I read the output side explicitly; the *input* stream-json semantics I did not find in the headless page text (it is documented in the SDK pages) | **Good, language-agnostic.** This is what sidetone uses (see 8). One warm process per session. |
| **Hooks** (https://code.claude.com/docs/en/hooks) | `Stop` gets `last_assistant_message` and can return `decision:"block"` + `reason` to *continue the conversation* (injects text); `Notification` (matchers `permission_prompt`, `idle_prompt`); `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `PermissionRequest` (can allow/deny); command hooks support `async` and `asyncRewake` (background hook wakes Claude on exit 2) | **Good for outbound (speak replies) and for injecting into a TUI session** (parlar's approach). Not an input channel when the session is idle unless you use `asyncRewake`/blocking Stop waiter. |
| **MCP server** (Claude calls tools) | `speak`/`converse` tool for outbound speech | Pull-only; nothing is pushed to the session. |
| **Channels** (research preview) https://code.claude.com/docs/en/channels | An MCP server declared as a channel **pushes events into a running interactive session**; two-way via reply tool; permission-relay capability so remote user can approve prompts; Telegram/Discord/iMessage official; sender allowlist/pairing. Needs `--channels` (flag hidden from `--help`), claude.ai or Console auth (not Bedrock/Vertex/Foundry), allowlist: custom channels need `--dangerously-load-development-channels`; Team/Enterprise must enable | **Best fit for injecting speech into the user's real, running session** and for a phone gateway (Telegram-style), but preview status and allowlist friction. claude-talk uses it. |
| **Remote Control** https://code.claude.com/docs/en/remote-control | Drive a local session from claude.ai/Claude mobile app; `claude remote-control` server mode, `--spawn`, `--capacity` | **Not usable for self-hosted voice**: client is Anthropic's app, needs claude.ai subscription (API keys unsupported), disabled when `ANTHROPIC_BASE_URL` is non-default; no programmatic API found in the page. |

Recommendation: Agent SDK / stream-json for a bridge you own (cleanest, resume-able, interruptible); Channels + Stop hook if you must attach to the user's existing interactive session.

## 7. anthropics/claude-code issues (voice in mobile Remote Control)

| # | Title (short) | State | Official response |
|---|---|---|---|
| 29399 | Voice input for Remote Control | **Closed** 2026-03-03, auto-closed by bot as duplicate of #25115; locked | None beyond bot |
| 42700 | TTS readback + voice mode for Remote Control sessions | **Open**, labels enhancement/area:tui/area:a11y; 44 comments, 74 reactions, updated 2026-11-24 | **No staff comment** (all 44 commenters author-association NONE). Designated canonical issue |
| 76005 | Conversational voice mode for RC mobile Code tab | **Closed** 2026-08-20 as duplicate of #42700 by `bcherny` (Anthropic staff, per login in bot-signed comment); locked | Dup-close only |
| 104372 | Voice mode in mobile Code tab for RC sessions | **Open**, 6 comments, created 2026-10-22; no staff comment | None |

Net: no committed roadmap statement. Users in 42700 report DIY Stop-hook + piper/SuperWhisper workarounds. [READ]

## 8. Gap search: does anything already combine phone + pairing + local coding agent + fully local two-way voice?

Searched GitHub (multi-word queries return little; keyword queries like `claude-code voice`, `voice claude-code mobile`, `claude-code livekit`, `claude-code pipecat` worked). All star counts approximate.

**Closest match: crsmithdev/sidetone** (https://github.com/crsmithdev/sidetone), MIT, 2 stars, created 2026-09-08, last commit 2026-11-03, 30+ commits. [READ]
- Phone (web client + side-loaded Android app that keeps mic open with screen off) --WebRTC/LiveKit (self-hosted via Docker)--> Bun "bridge" --`stream-json` both ways--> one warm `claude` process in a project dir. Pairing by a three-word code + 30-day token; HTTPS via Tailscale cert. STT faster-whisper; TTS Chatterbox (default) / Kokoro on GPU, Piper on CPU; sentence-cutter so TTS starts while the reply is still streaming; barge-in; wake-word commands ("sidetone, end turn"); spoken "continue" for risky commands; narrator that voices what a tool is doing; supervisor that restarts crashed/looping Claude. Files: `src/{bridge,session,ear,mouth,narrator,sentences,supervisor,transport,commands}.ts`, `speech/*_worker.py`, `client/index.html`, `android/`, `docs/spec.md`, `docs/adr/`. [READ]
- **Limitations (self-stated):** requires NVIDIA GPU + CUDA ("no cloud fallback"), Linux/WSL2 only, one bridge = one session in one directory, voice-only (transcript not diff), not packaged (checkout + Python env + sideload APK), Bun >= 1.4.2. `spawnClaude` launches `claude` with the user's `claudeArgs` plus model/effort (flags for stream-json live in config; I did not read them). Tiny community (2 stars, no issues).
- **Fit:** it is the only project that matches the exact architecture. Laptop with 3050 Ti 4 GB VRAM may fit faster-whisper + Kokoro/Piper but Chatterbox default likely too heavy [INFERRED]. ARM server unsupported as-is (CUDA) but Piper/CPU engines exist [partly READ].
- **Verdict: fork & modify, or at minimum read `docs/spec.md` + ADRs before designing.** Replace CUDA-bound workers with OpenAI-compatible endpoints (speaches/voicebox) so STT/TTS can live on the ARM server or laptop.

**Other candidates (all fail at least one constraint):**
| Project | What | Why not |
|---|---|---|
| klarluft/pitupitu (Apache-2.0, 206*, active) | Phone app + box agent; voice via hosted service; phone call numbers | Conversation/voice/apps are a **hosted cloud service**; box agent only dials out (README). Violates no-cloud. Requires herdr. |
| sesamkowalski/terminalvox (Apache-2.0, new) | Pipecat WebRTC browser/phone -> STT -> tmux/herdr keystrokes -> reads JSONL transcript tail for TTS | Default STT/TTS ElevenLabs/Google cloud; local Silero TTS Russian only. Good architecture reference (tmux keystrokes + transcript tail). |
| softcery/claude-code-voice-relay (MIT, 1*) | Plugin; voice agent in a browser window next to Claude Code, multi-session | Needs ElevenLabs+OpenRouter keys, or "This computer" local engines; browser on same machine, not phone [INFERRED from README]. |
| jaredrhod/backtalk (AGPL-3.0, 99*) | Local Whisper + voice, hold-key, uses Agent SDK | Desktop only. |
| theNetworkChuck/claude-phone (350*) / agentring / twring (AGPL+Apache; self-hostable) / ZeframLou/call-me | Phone calls (SIP/VoIP) to/from Claude Code | Telephony/cloud providers or hosted relay; audio not local. [mostly UNVERIFIED beyond descriptions] |
| AltanS/collie (ColliePWA, MIT, 1.7k*) | Phone PWA over Tailscale for terminal agents (herdr); built-in local "Whistle" speech-to-text for dictation | STT only, no spoken replies [READ README]. Good pairing/PWA reference. |
| K9i-0/ccpocket, hitosea/happy-next, ZacxDev/muster, crsmithdev/sidetone, dim4ai/claude-wheel (MIT, 0*) | Mobile clients for Claude Code, some with voice | claude-wheel is a "mobile voice interface for Claude Code" with a server + app + TTS proxy; not read in depth. [UNVERIFIED] |
| labsdotglass/voice-assistant (MIT) | `/talk` orb in Claude desktop app | macOS Apple silicon only, desktop. |
| anthropics Channels: Telegram/Discord/iMessage plugins | Official chat bridges with voice-note transcription in some third-party ones (e.g. Rich627/whatsapp-claude-plugin) | Text apps via third-party servers, not local voice. |

**Conclusion:** no off-the-shelf tool satisfies all of phone client + pairing + local STT/TTS on arbitrary hardware + spoken-summary behaviour. Sidetone is ~70% of it but CUDA-only and single-session.

## 9. Building blocks

| Component | Licence | Activity | Notes for this project |
|---|---|---|---|
| Pipecat (pipecat-ai/pipecat) | BSD-2 | active (17k*) | Python voice-agent pipeline framework; WebRTC (Daily/SmallWebRTC), VAD, STT/TTS service adapters incl. local; terminalvox is built on it. ARM: pure Python, deps vary [UNVERIFIED] |
| LiveKit server + Agents (livekit/livekit, livekit/agents) | Apache-2.0 | active | Self-hostable SFU (Go, ARM64 Docker published upstream [UNVERIFIED]); sidetone uses the server. Heavier than needed for a single user. |
| Silero VAD | MIT | active | Tiny ONNX, runs anywhere incl. ARM; used by parlar, pipecat |
| Smart Turn v3 (end-of-turn model) | not checked | | used by parlar and terminalvox [READ] |
| whisper.cpp | MIT | very active (55k*) | CPU-friendly; has server mode with OpenAI-like endpoint; used by voicemode and claude-talk |
| faster-whisper | MIT | active | CTranslate2; fast on CUDA, OK on CPU int8; used by voicebox, sidetone |
| Kokoro (hexgrad/kokoro) / kokoro-onnx / Kokoro-FastAPI | Apache-2.0 / MIT / Apache-2.0 | kokoro repo last push 2025-08; others active | 82M params; runs on CPU; `remsky/Kokoro-FastAPI` gives OpenAI-compatible `/v1/audio/speech` (voicemode default) |
| Piper | rhasspy/piper **archived** (MIT, last push 2025-08); successor OHF-Voice/piper1-gpl **GPL-3.0** | successor active | Licence change matters for an open-source project: GPL-3.0 if linked/derived; voicebox uses Piper (which package: UNVERIFIED) |
| speaches (speaches-ai/speaches) | MIT | very active | OpenAI-compatible STT+TTS server (faster-whisper, Kokoro, Piper); strong candidate for the ARM server [description only, source not read] |
| AEC (WebRTC AEC3 via sonora crate) | | | parlar's approach; on a phone the OS handles AEC if you use WebRTC/`getUserMedia` echoCancellation [INFERRED] |

## 10. Surprises / flags
- Happy's mobile apps are now native Swift/Kotlin, not RN/Expo, and its Claude-session voice is currently disabled; voice only exists for "Happy Agent connections" via a hard-coded public ElevenLabs agent ID.
- Happy's own docs admit the ElevenLabs agent ID is "not authentication".
- Sidetone (nearly unknown, 2 stars) already implements the full phone -> self-hosted LiveKit -> stream-json -> Claude Code design.
- Piper upstream was archived and moved to a GPL-3.0 repo; claude-talk has no licence; voicebox publishes amd64-only images.
- Remote Control cannot be used with a custom `ANTHROPIC_BASE_URL` or API-key auth, and Anthropic has not responded substantively to the voice issues (#42700 has zero staff comments; a staff member only closed #76005 as dup).
- Not verified: parlar/sidetone behaviour in practice (nothing was run), Happy's custom-server flow in the native apps, Pipecat/LiveKit ARM images.
