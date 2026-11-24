# Brief: Talkative landing page

For: an agent building the landing page on the future Talkative website.
Written: 2026-11-24. Status of the product: **in development, not released**. Read the whole brief before you design anything. The section "Claims you may not make" is binding.

## 1. What Talkative is (one paragraph)

Talkative lets you hold a real spoken conversation with Claude Code from your iPhone, away from your desk, for example at the gym or on a train. You talk with your phone in your pocket and the screen locked, and you can interrupt it mid-sentence. The coding agent runs on your own computer. Speech recognition and speech output run on hardware you own: a small always-on server, or the same computer. By default, no third-party cloud hears your audio or sees your session. Talkative is open source.

## 2. Who it is for

Developers who already use Claude Code and run long tasks with it. They want to keep steering and discussing that work when they step away, by voice, with their hands and eyes busy. They care about privacy and are comfortable self-hosting: a home server, a cheap cloud VM, Tailscale.

Not for: people looking for a hosted voice assistant, non-developers, or Android users (no Android app is planned for the first version).

## 3. The core message

**Talk to your coding agent like a colleague — from anywhere, on hardware you own.**

Supporting points, in priority order:
1. **A conversation, not dictation.** It talks back in plain spoken language and you can cut in. It summarises decisions and progress, and never reads code aloud. Code and diffs appear on screen for when you look.
2. **It keeps working while you talk.** The coordinator hands long jobs to background subagents and stays free to chat. When a job finishes, it tells you on its own.
3. **Private by default.** Speech runs on your own machine or server, reachable only over your private Tailscale network. No third-party voice service is involved unless you explicitly switch one on.
4. **Built for pockets and bad signal.** It works with the screen locked and earbuds in. It survives tunnels and dropouts, and tells you what you missed when you reconnect.
5. **You stay in control.** Anything that needs your permission waits for you to tap Approve on your phone. If you don't answer in time, the answer is "no". Approving by voice may come later, so don't promise it on the page.
6. **Runs your way.** Split setup (speech on an always-on server, agent on your computer) or everything on one machine.

## 4. Page structure (suggested; adapt freely)

1. **Hero.** Headline plus one-line subhead. A visual of someone mid-workout or on a train with earbuds, phone in pocket. Primary call to action: see section 6.
2. **The problem, in two lines.** Your agent works for twenty minutes at a time. You shouldn't have to sit and watch it.
3. **How a conversation feels.** A short scripted exchange, styled as a transcript: the owner asks about progress, interrupts, the agent reports a finished background job, the agent asks for approval on the phone before pushing. Keep it under 8 lines. Mark it clearly as illustrative.
4. **The six points from section 3**, each as a short card.
5. **How it works.** One simple diagram: iPhone → (Tailscale) → voice side (speech recognition, speech output) → text only → agent host on your computer → Claude Code and its subagents. Show the alternative "everything on one machine" as a toggle or a second small diagram.
6. **Privacy section.** What stays on your hardware and what never leaves it. State it plainly, with no marketing hedging.
7. **Open source.** Licence (MIT) and a link to the repository (see open questions).
8. **Status and FAQ.** It is in development, with a short FAQ (section 7).
9. **Footer.**

## 5. Tone and design

- **Voice:** plain, confident, developer-to-developer. Short sentences. No hype words ("revolutionary", "AI-powered magic").
- **Theme:** "a colleague you can talk to". Calm and conversational rather than futuristic or robotic.
- **Design:** clean, generous whitespace, works in light and dark mode, readable on a phone first. Most visitors will arrive on mobile.
- **Visual motif:** speech, transcript bubbles, sound waves. Avoid robot faces and glowing brains.
- **Accessibility:** good contrast, real text rather than text baked into images, and a page that works with a screen reader.

## 6. Calls to action

The repository is private today. Until the owner says otherwise:
- **Primary CTA:** "Follow development" or "Get notified". Build it as a placeholder form or link. **Do not wire it to any third-party email or analytics service.** Leave the endpoint as a clearly marked TODO for the owner to decide.
- **Secondary CTA:** "Read the design", linking to a placeholder for the public repo URL.

## 7. FAQ content you may use

- **Does it work on Android?** Not in the first version. iPhone only.
- **Is it in the App Store?** No. Early versions are installed by sideloading. App Store distribution may come later.
- **Do I need a GPU?** No. Speech can run on a CPU server. A GPU makes it faster.
- **Does my audio go to the cloud?** Not by default. Speech runs on your own hardware. Cloud speech engines can only be enabled explicitly.
- **Which coding agent?** Claude Code. It uses your normal Claude Code login, and Talkative is not affiliated with Anthropic.
- **What does it cost?** Talkative is free and open source. You pay for your own Claude usage and for any server you choose to run.

## 8. Claims you may not make (binding)

- **No latency numbers** ("sub-second", "3-second replies") and no accuracy numbers. Benchmarks are still running. Leave a marked placeholder if a section needs one.
- **No implied affiliation** with, endorsement by, or partnership with Anthropic.
  - Don't use Anthropic's or Claude's logos or brand styling.
  - Refer to "Claude Code" only by name, to say what Talkative works with, for example "works with Claude Code".
  - Include a footer line: "Talkative is an independent open-source project and is not affiliated with Anthropic."
- **Don't say "available now"**, "download", or "App Store". It isn't released.
- **Don't call it "completely private" or "end-to-end encrypted".** Say what is true: speech runs on your hardware, traffic goes over your Tailscale network, and no third-party voice service is used by default.
- **No Android, Windows or macOS host support.** None of these are in the first version.
- **No invented testimonials, user counts, logos of "companies using it", or star counts.**
- **No named third-party projects** (sidetone, Happy, LiveKit, Whisper, and so on) on the page without the owner's approval, even though Talkative builds on some of them.

## 9. Deliverable

- **A single static landing page** (HTML/CSS, or the site framework the owner chooses), responsive, light and dark.
- **No tracking scripts, analytics, or third-party embeds.**
- **Placeholders, clearly marked with `TODO(owner)`:**
  - repository URL;
  - notify/follow endpoint;
  - hero image or illustration, if not generated;
  - any latency figure.
- **A short README** listing every placeholder and every copy decision the owner should check.

## 10. Open questions for the owner

Answer these before the page goes live:
1. The domain name, and whether "Talkative" is clear to use as a product name (trademark check).
2. When the repository goes public, and its URL.
3. The notify/follow mechanism, if any, and which service.
4. A logo or wordmark. Is there one, or should the agent propose a simple text wordmark?
5. Whether to show a screenshot of the iOS app. One won't exist until the app milestone, so use a placeholder until then.
