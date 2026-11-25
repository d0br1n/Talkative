# Design: the Talkative iPhone app (milestone 3)

Date: 2026-11-25. Status: draft for the owner's approval. This document refines spec 6.5 of [`2026-11-24-phone-voice-agent-design.md`](2026-11-24-phone-voice-agent-design.md). The background research is in [`research/ios-recon.md`](../../research/ios-recon.md).

## 1. Intent

The app is the owner's only interface while they're away from the desk. It is mostly heard, not seen: the phone sits in a pocket with the screen locked, and earbuds carry the conversation. When the owner does look, the screen should feel unmistakably like Talkative: a phosphor terminal with a living voice-bar, not a generic chat app.

**Owner's direction:** the app has character and follows the landing page's CRT theme. Happy's UI is not a requirement and nothing is borrowed from it.

## 2. Goals

1. **Background conversation.** Join the voice room and keep talking with the screen locked, through AirPods or other Bluetooth earbuds, across network changes. Reconnect without user action.
2. **The CRT look, in both modes.**
   - Dark mode is the phosphor monitor: amber on near-black, scanlines, vignette, glow on the mark and headings.
   - Light mode is the amber printout: cream background with ink.
   - The app follows the system setting.
   - The ASCII wordmark from the owner's logo project sits at the top of every screen. The pair screen shows the full logo: the mark stacked over the wordmark.
3. **The voice-bar mark as the centrepiece.** It is the landing page's ASCII animation, reacting to whoever is talking:
   - while listening, to the owner's mic;
   - while speaking, to the voice's output;
   - each of the 14 bars follows one frequency band of that audio, so the bars jump on syllables and fall to a thin line in silence;
   - while thinking, a slow shimmer;
   - while the agent is down, a dim, mostly still frame.
4. **The transcript.**
   - Terminal-style lines: `you ›` for what was heard, `agent ›` for the replies.
   - Replies stream as deltas.
   - The sentence being spoken is lit, and text not yet spoken is dimmer.
   - Code and tables appear in box-drawing panels, readable, monospace, and scrollable sideways.
5. **Approvals.**
   - A full-width panel per pending approval, showing the tool, the summary and the detail (expandable), with `[ approve ]` and `[ deny ]` and a countdown to `expiresAt`.
   - A haptic when a new one arrives.
   - It survives reconnects, using the server's re-send by id.
6. **Pairing.** The owner enters the voice side's address (Tailscale IP and port) and the three-word code, which is exchanged once for a token kept in the Keychain. Re-pairing is possible from Options.
7. **Options.**
   - Verbosity (brief, normal, full), model and effort.
   - Audio on/off and mic on/off.
   - New conversation.
   - Leave and rejoin.
   - Unpair.
8. **Logs for remote debugging.** There is no Mac and no debugger, so the app sends its own error lines and connection log to the voice side, which writes them to a file.
9. **Builds without a Mac.**
   - The core logic is tested on Linux.
   - The app is built as an unsigned `.ipa` on GitHub Actions and installed with SideStore on a free Apple ID.

## 3. Non-goals

- Android.
- Push notifications, and waking the app when it isn't running (a free account has no push).
- The App Store or TestFlight. Nothing may block them later, though: no GPL code in the app.
- Approving by voice. That stays off until accuracy is confirmed (spec 6.8).
- A chat keyboard as a main input. A small "type instead" field exists for when speaking isn't possible, using the existing `said` message.
- iPad layouts.

## 4. Anti-goals

- **Looks like a stock chat app:** rounded speech bubbles, SF fonts, blue accents.
- **Effects that hurt reading:** glow or scanlines on body text strong enough to blur it, or contrast below WCAG AA.
- **Motion that ignores Reduce Motion.** With Reduce Motion on, the mark freezes to a static frame and the flicker stops.
- **Battery drain from the animation while the screen is off.** Rendering pauses whenever the app isn't in the foreground.

## 5. Constraints

- **No Mac and no paid account:**
  - an unsigned `.ipa` from CI;
  - SideStore with a free Apple ID: 7-day signing, 3 active apps, 10 App IDs a week;
  - empty entitlements: no App Groups, iCloud, push or extensions.
- **Background audio** uses the `audio` background mode, which is an Info.plist key, not an entitlement. It is expected to survive free re-signing, but that isn't confirmed. The first device check proves it.
- **Platform:**
  - LiveKit Swift SDK 2.20.0, which needs Xcode 26, so CI uses the `macos-26` runner.
  - Minimum iOS 17: the AirPods press-to-mute gesture needs it, and so do modern SwiftUI APIs. (My call.)
- **Plain HTTP and WS** go to the voice side over Tailscale, so the app needs an App Transport Security exception. Allowing local networking alone isn't enough for 100.x addresses, so it's `NSAllowsArbitraryLoads`, justified because all traffic stays on the tailnet.
- **CI budget:** the repository was made public on 2026-11-25 (owner's decision), so standard GitHub Actions runners, macOS included, are free.
  - Linux `swift test` runs on every push.
  - The macOS app build runs on pushes to `main`, on version tags, and on manual dispatch. It stays off feature branches to keep the feedback loop fast.
  - SideStore installs straight from the public GitHub release through a source JSON committed in the repo.
- **Font:** JetBrains Mono, bundled as a `.ttf`/`.otf` resource. OFL 1.1, which is fine in an app; ship `OFL.txt` with it.
- **No GPL code in the app.**

## 6. Architecture

```
ios/
  project.yml                 XcodeGen spec (generated .xcodeproj is not committed)
  TalkativeCore/              Swift package, Foundation only, builds and tests on Linux
    PhoneProtocol             mirror of src/shared/phone.ts (Codable, strict validation)
    ConversationStore         pure reducer: ToPhone messages and local events give app state
                              (transcript, spoken sentence, status, approvals with countdowns, errors)
    Pairing                   POST /pair client behind a tiny HTTP protocol (fake in tests)
    MarkRenderer              port of site/mark.js: frame(t, bands) to 15×56 characters, one band level per bar, deterministic
    Theme tokens              colour and glow values from site/styles.css as data
  Talkative/                  iOS app target (SwiftUI)
    RoomController            LiveKit connect, mic publish, remote voice track, data channel,
                              reconnect states, 14 band levels for the mark (FFT of the mic or the voice output)
    AudioSessionController    .playAndRecord with .voiceChat, Bluetooth HFP and A2DP;
                              interruption and route-change observers; AirPods press-to-mute
    TokenStore                Keychain
    Views                     Pair, Main (mark, status line, transcript), ApprovalPanel, Options
    CRT                       scanline and vignette overlay, glow modifiers, font registration
```

- **One source of truth.** Every screen renders `ConversationStore` state. `RoomController` turns LiveKit events into store actions.
- **Tests cover the core.** Everything worth testing lives in `TalkativeCore` and is tested on Linux. The app target is thin glue, checked on the device.

### 6.1 Small server additions (the voice side, TypeScript)

The phone protocol lacks what Options and logging need. Each change adds messages without breaking existing ones, and `PHONE_PROTOCOL` stays 1.

- **FromPhone `settings{verbosity?, model?, effort?}`.**
  - The voice applies verbosity locally.
  - It forwards model and effort to the agent as the existing link `settings`.
- **ToPhone `settings{verbosity, model, effort}`.** It is sent on join and after any change, so Options shows real values.
- **FromPhone `command{name: "new conversation" | "stop"}`.** The same path as the spoken commands.
- **FromPhone `log{level: "info" | "error", text}`.**
  - The voice appends it to `~/.talkative/phone.log`, mode 600.
  - Each line is capped at 2 KB and the file at 5 MB, rotating to `.1`.
  - It is rate-limited to 20 lines a second.

### 6.2 AirPods controls

- **What works.** Apple routes earbud presses during a call-style session to hands-free and gives no play/pause callback. iOS 17's press-to-mute (`AVAudioApplication` mute-gesture handling) does arrive. The research didn't verify the exact API name, so the build checks it before use.
- **Mapping.** A press acts as "stop talking": the voice stops speaking (a barge-in) and the mic stays live. (My call.)
- **Fallback.** If iOS can't be made to deliver the press, the on-screen `[ stop ]` button and the spoken "stop" remain.
- **Verified on device**, not on the simulator.

## 7. The look

### 7.1 Tokens

These are taken verbatim from `site/styles.css`:

| Token | Dark (phosphor) | Light (printout) |
|---|---|---|
| background | `#0C0A07` with the radial amber glow | `#F5EEE0` |
| text | `#FFE2A8` | `#1B1409` |
| accent | `#FFC453` | `#A85200` |
| muted | `#D4B888` | `#6E5B3E` |
| border | `#A88E60` | `#8F7A5C` |
| glow | the four-layer amber glow on the mark and headings; body text 1 px at most | none |
| overlays | scanlines (1 px dark, 2 px clear, 18%) and a vignette (20%) | none |

### 7.2 Screens (text sketches; dark mode)

**Main**

```
 TALKATIVE  (the ASCII wordmark)   ⚙
 ● listening · 2 jobs running

        :   +,      .  =#*
      .=*+  %#=  '  +#@%+ ,:     voice-bar mark,
     *#@@%=*@@&*=+:*@@@@#*=+'    driven by live audio
      .=*+  %#=  '  +#@%+ ,:
        :   +,      .  =#*

 ## transcript
 you ›        how's the refactor going
 agent ›      Two of three modules are done.
              The tests are still running.     ← spoken sentence lit
 ┌─ code ─────────────────────────┐
 │ src/voice/ear.ts  +42 −17      │
 └────────────────────────────────┘
                                   [ stop ]  [ type ]
```

**Approval panel** (slides over the transcript and stacks if there are several)

```
 ┌─ approval needed ── 29:41 ─────┐
 │ Bash: git push origin main     │
 │ ▸ details                      │
 │ [ approve ]          [ deny ]  │
 └────────────────────────────────┘
```

**Pair**

```
        (the logo: mark over the ASCII wordmark)

 pair › voice side   100.101.102.103:7890
 pair › code         amber wire lantern
                     [ connect ]
```

**Options** is a terminal menu: `verbosity  [brief] normal  full` and so on, with `[ new conversation ]`, `[ leave ]` and `[ unpair ]`.

### 7.3 Status line vocabulary

| State | Line |
|---|---|
| Agent ready, idle | `● listening` |
| An owner turn is open | `▲ thinking` |
| Background jobs | `· N jobs running`, appended |
| Agent restarting | `◌ restarting` |
| Agent down or link lost | `✕ agent down` |
| Phone reconnecting | `… reconnecting` |
| Microphone off (the owner's choice, an interruption, or a failed publish) | `mic off`, appended before `♪ off` |
| Audio off | `♪ off`, appended |

The status line is accessible text, not decoration.

## 8. Approaches considered

| Approach | Trade-off | Outcome |
|---|---|---|
| **XcodeGen project plus a Linux-testable core package, built on GitHub Actions, installed with SideStore** | No Mac needed. Most logic is tested on every push, and only thin glue needs the device. Costs macOS minutes and a manual device check. | **Chosen** |
| Fork `livekit-examples/agent-starter-swift` | Built around LiveKit's agent abstractions, which don't match our raw room and `POST /pair`. It carries an extension and entitlements a free account can't use. | Rejected; ideas only |
| Build and sign from Linux with `xtool` (MIT) | No CI minutes, and installs over USB. Needs the Xcode SDK extracted on Linux; not evaluated. | Kept in reserve if CI or SideStore prove painful |

## 9. Testing

- **Core** (`TalkativeCore`):
  - `swift test` runs on Linux: locally through the official `swift` Docker image (Docker is installed; nothing installed on the host) and in CI on `ubuntu-latest`.
  - The protocol tests check every message variant against the same JSON the TypeScript codec emits. Shared fixtures are generated from `src/shared/phone.ts` so the two can't drift.
- **Server additions:** `bun test`, as in milestone 2.
- **App build:** `xcodebuild` on `macos-26` on a tag or a manual trigger. It produces the `.ipa` as a workflow artifact and a GitHub release asset.
- **On the device**, an owner checklist, recorded in `docs/ios/device-checklist.md`:
  1. Pair.
  2. Talk with the screen locked.
  3. Switch AirPods in and out.
  4. Take a phone call mid-conversation.
  5. Cross Wi-Fi to cellular.
  6. Approve from the panel.
  7. Press an AirPods stem to stop.
  8. Check the 7-day SideStore refresh.

## 10. Questions for the owner

1. **Repository visibility.** Answered: public, since 2026-11-25.
2. **The iPhone's iOS version.** This sets the minimum. iOS 17 is assumed.

## 11. Calls I made (for the owner to check)

- Nothing from Happy, and no fork of the LiveKit starter app.
- iOS 17 minimum.
- An AirPods press stops the voice; it doesn't mute you.
- The ATS exception is `NSAllowsArbitraryLoads`, justified by tailnet-only traffic.
- CI policy: Linux tests on every push; the macOS build on `main`, on version tags and on manual dispatch.
- A SideStore source JSON committed in the repo, pointing at the latest release `.ipa`.
- Server additions: `settings`, `command` and `log` phone messages, with no protocol version bump.
- Local Swift tests run in Docker.
- A small "type instead" input for when speaking isn't possible.
- The animation pauses when the app isn't in the foreground, and freezes under Reduce Motion.
