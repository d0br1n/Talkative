# iOS recon (read-only, 2026-11-25)

Item 6 (Happy iOS components) dropped at the coordinator's request. Marks: [V] verified from a primary source this session, [U] unverified/inferred.

## (a) Base and project setup

**agent-starter-swift** (MIT, active; last push 2026-11-24) [V]
- Plain `VoiceAgent.xcodeproj` (checked in; no XcodeGen/Tuist/Package). SPM deps pinned in `project.xcworkspace/.../Package.resolved`: client-sdk-swift 2.20.0, components-swift 0.1.7, livekit-ffi-xcframework 0.13.4, webrtc-xcframework 150.7871.8.
- Targets: VoiceAgent app + BroadcastExtension (screen share; strip). Deployment iOS 18.0 / macOS 15; Swift 6.0 (`.swift-version`).
- Files: App/{AppView,StartView,ErrorView}, AudioOptions/, Chat/, ControlBar/, Interactions/{Voice,Text,Vision}, Media/, Helpers/, VoiceAgentApp.swift.
- Connect: `Session(tokenSource:options:)` with `EndpointTokenSource` / `DevelopmentTokenSource` (LiveKit Cloud). Token is requested from an HTTPS endpoint; `LocalMedia` owns mic. It is built around the Agents `Session`/`Agent` abstraction (expects an agent participant, preConnectAudio, transcription streams), which does not match our raw room + `phone` identity + `/pair` flow.
- Audio: Info.plist has `UIBackgroundModes: audio`. No app-level AVAudioSession code; the SDK configures it. No interruption handling in the app.
- Entitlements: `networking.multipath` and App Group. Both must be removed for a free account [U that free rejects them; see item 5].
- Keep: Info.plist background mode pattern, AudioOptions (voice-processing mode picker), Style/colors, Spinner idea. Strip: BroadcastExtension, video/screen share, app group, multipath, Session/Agent/TokenSource wiring (replace with our own Room + `/pair` client), macOS/visionOS branches.
- Recommendation: do NOT fork. Write a small own app (XcodeGen `project.yml` + local Swift package for core) and copy ideas only. Starter is MIT so copying is allowed.

**Toolchain constraint** [V]: client-sdk-swift 2.20.0 `Package.swift` is `swift-tools-version:6.2` ("Xcode 26.0+"), platforms iOS 13+. Our CI needs Xcode 26.x. Runner `macos-26` (alias `macos-latest`, arm64) has Xcode 26.6 default (26.0.1 to 26.6 present), iOS 26.x simulators. Starter's own CI uses a preview `xcode-27` runner (not needed).

## (b) Background audio and AirPods on a free account

- `UIBackgroundModes: audio` is an Info.plist key, not an entitlement/capability. Apple DTS says background modes are not gated by an entitlement [V via search snippet of forum thread 787026, not read in full]. So SideStore re-signing with a free team should keep it. No source found that explicitly confirms it end-to-end on SideStore [U]; test on device early.
- Push Notifications: not available to personal teams [V via forum snippet]. CallKit itself needs no entitlement (CallKit/PushKit VoIP push would need push, which we don't use) [U]. CallKit is not required for us; the LiveKit README documents the SDK works with CallKit by disabling auto session config, but it is optional.
- LiveKit audio session [V, Docs/audio.md and source]: auto-config is on. Playout only = `.playback`; once the mic publishes, `.playAndRecord` (sticky until the engine stops). Presets: `playAndRecordSpeaker` = `.playAndRecord`, mode `.videoChat`, options `[.allowBluetoothHFP, .allowBluetoothA2DP, .allowAirPlay, .defaultToSpeaker]`; `playAndRecordReceiver` = mode `.voiceChat`, same minus speaker. No `.mixWithOthers` in call mode (interrupts other apps' audio). Software-processing variants use mode `.default`. Defaults to the speaker (`isSpeakerOutputPreferred = true`); for earbuds the route follows the connected Bluetooth device.
- Manual override: `AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false`, then configure `.playAndRecord` + `.voiceChat` before publishing the mic (README note).
- Echo cancellation / voice processing: default `.automatic` prefers Apple VPIO, falls back to WebRTC software. `AudioCaptureOptions(echoCancellationMode:…)`, `localAudioTrack.setAudioProcessingOptions`, `AudioManager.shared.audioProcessingState`, `setPlatformVoiceProcessingAllowed(false)`.
- Screen lock: with `audio` background mode and an active session the process keeps running and the WebRTC engine stays alive. No LiveKit issue found specifically for lock-screen audio [U: only searched issue titles]. Related open issues: #886 (audio recording fails to resume after incoming call interruption, background), #1011 (inaudible during calls/alarms, closed). The SDK has no visible `interruptionNotification` handling in what I searched; plan our own observer for `AVAudioSession.interruptionNotification` and route changes, and re-activate / re-publish the mic after `.ended` [U].
- AirPods controls (key risk) [partly V]:
  - Apple DTS (forum 761549): in a call-style session Bluetooth switches to HFP; HFP commands are handled by the system with no public API; `MPRemoteCommandCenter` does not get headset call-control events. Forum 688838: with `.allowBluetooth*` options in `.playAndRecord`, handlers got no events; no answer. So `togglePlayPause` via `MPRemoteCommandCenter` in `.playAndRecord/.voiceChat` is NOT reliable [U on current iOS; test on device].
  - Better path: iOS 17+ "press to mute/unmute". CallKit apps get it free; non-CallKit apps adopt via `AVAudioApplication` mute-gesture notification (WWDC23 session 10233) [V via search summary; read exact API name `AVAudioApplication.inputMuteStateChangeNotification` before use]. The `setInputMuteStateChangeHandler` closure is macOS-only per docs [V via summary]. This gives AirPods stem press = mute toggle, which maps to push-to-talk/mute UX. Requires AirPods Pro/AirPods 4-class hardware that supports the gesture [U].
  - Fallbacks: on-screen big button, headset button via `MPRemoteCommandCenter` registered with Now Playing info set (works when the app is the Now Playing app, mainly in `.playback`), Action Button / lock-screen Live Activity is not feasible without paid features.

## (c) CI build recipe and minute budget

- Runner: `macos-26` (or `macos-latest`), arm64 (M-series), Xcode 26.6 default; select with `sudo xcode-select -s /Applications/Xcode_26.6.app` or `maxim-lobanov/setup-xcode`. Pre-installed: xcbeautify, SwiftFormat. XcodeGen: not in the image readme I grepped [V that grep found none]; `brew install xcodegen` (latest 2.48.0, MIT, released 2026-11-19). Mint not checked.
- Recipe (standard, [V] as a known pattern, not run):
  1. `xcodegen generate`
  2. `xcodebuild -project Talkative.xcodeproj -scheme Talkative -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build`
  3. `mkdir Payload && cp -R build/Build/Products/Release-iphoneos/Talkative.app Payload/ && zip -r Talkative.ipa Payload`
  Archive variant also works (`xcodebuild archive`, then take `.xcarchive/Products/Applications/*.app`). Upload via `actions/upload-artifact` or attach to a release (`gh release upload`) for SideStore.
- SPM cache: cache `~/Library/Caches/org.swift.swiftpm` and `build/SourcePackages` (`-clonedSourcePackagesDirPath`) keyed on `Package.resolved`. WebRTC xcframework is large, so caching matters. Cache limit 10 GB per repo.
- Minutes [V, docs.github.com billing/concepts/product-billing/github-actions and .../reference/actions-minute-multipliers]: billing is now dollar-based, no multiplier table. Free plan includes $12/month of compute (about 2,000 Linux 2-core minutes). Standard macOS 3/4-core runner is $0.062/min, so $12 buys about 193 macOS minutes/month on a private repo; Linux $0.006/min. Standard runners in public repos are free and do not count against the allowance. Free-plan artifact storage 500 MB (a WebRTC-based ipa is likely 20 to 40 MB [U], so prune old artifacts). Practical: run Linux jobs (swift test) on ubuntu, and the iOS build only on tag/manual dispatch; budget about 8 to 15 min per macOS build cold [U] means roughly 13 to 24 builds/month private. Making the repo public removes the limit.
- Simulator tests: `xcodebuild test -scheme X -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.4'` (simulators listed in the image: iPhone 17 family on iOS 26.2/26.4/26.5) [V for image contents]. Mic/background audio cannot be validated in simulator.

## (d) SideStore

- Latest release 0.7.0-alpha (2026-09-15) [V]. Free account limits [V, docs.sidestore.io FAQ]: 3 active apps including SideStore itself; 10 App IDs per week; 7-day profile, SideStore auto-refreshes in the background; needs a local VPN (LocalDevVPN) to talk to the device. Our app uses 1 slot + 1 App ID (each app extension would use more; avoid extensions).
- Install from GitHub release: SideStore uses AltStore-style source JSON (`apps[]` with `versions[]` containing `version`, `date`, `downloadURL` (direct .ipa URL), `size`, optional `minOSVersion`) [V via AltStore docs; SideStore's own schema docs not read]. Alternatives: download the .ipa in Files and open with SideStore ("Import IPA"), or iloader on a PC [U]. A private repo's release asset URL needs auth, so SideStore cannot fetch it; host the source JSON/IPA publicly (e.g., a public releases-only repo or Pages) or transfer the file manually.
- Avoid: Push Notifications, iCloud, App Groups, Multipath, Network Extensions, associated domains. Apple's capability page lists them, but the extracted text lost the per-tier checkmarks [U for each except push]. Keep the entitlements file empty. Background Modes via Info.plist only.
- ATS: our phone talks plain HTTP to a Tailscale address, so set `NSAppTransportSecurity` (`NSAllowsLocalNetworking` does not cover 100.x; use `NSAllowsArbitraryLoads` or exception domains) [U]. Also `NSMicrophoneUsageDescription`.

## (e) Linux-testable core

- Official toolchain is available for Linux x86_64 (swift.org tarball or swiftly; latest release tag seen 6.4.3 [V via GitHub API]; swift not installed on this machine [V]). A pure SwiftPM package with only Foundation works with `swift test`; Codable/JSONEncoder/Decoder, Data, URL, Date are in swift-corelibs-foundation/swift-foundation. Gotchas [U, from general experience]: use `import FoundationNetworking` for URLSession; avoid Combine/os/OSLog/AVFoundation (use `#if canImport(...)`); `JSONEncoder` key order and Date formatting can differ, use `.sortedKeys`/ISO8601 explicitly; `Dispatch` exists; XCTest and swift-testing both work.
- Layout: local package `TalkativeCore` (wire codec for the data-channel JSON, state machine, pairing client logic behind a protocol); `swift test` on ubuntu in CI (cheap), app target depends on it. Package tools-version must be satisfied by the Linux toolchain; set the core's tools version low (5.9 or 6.0) and platforms `.iOS(.v17)`.
- Alternative for Mac-less building: xtool (MIT, active) builds/signs iOS apps from Linux with a free Apple ID [U: not evaluated]. Mention only as an option; owner chose CI + SideStore.
