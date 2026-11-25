# Talkative landing page: owner notes

This is a static page. No build step. No framework. No third-party requests.

## How to view locally

```
python3 -m http.server -d site 8000
```

Then open `http://localhost:8000`.

## What's here

- `index.html`: the page.
- `styles.css`: the terminal look, light and dark.
- `mark.js`: the listening animation (at most 5 seconds per run), the diagram toggle and the placeholder form handler.
- `fonts/JetBrainsMono-Regular.woff2`, `fonts/JetBrainsMono-Bold.woff2`: self-hosted font files.
- `fonts/OFL.txt`: the font licence.
- `README.md`: this file.

## Placeholders

Each `TODO(owner)` in the source, and what it needs.

| Where | What it is | What's needed |
|---|---|---|
| `site/index.html:40` | Hero photo slot | Optional. A photo, or leave the animated mark. |
| `site/index.html:59` | Notify form endpoint | Which service, and its URL. The form sends nothing now. When you wire it up, give the email input a `name` and update the guard test, which currently forbids named fields. |
| `site/index.html:66` | Repository URL, for the hero "read the design" button | The public repository URL, or the design document URL. |
| `site/index.html:215` | Repository URL, for the open source "read the design" button | The public repository URL, or the design document URL. |
| `site/index.html:252` | Repository URL, footer "Repository" link | The public repository URL. |
| `site/mark.js:199` | Notify endpoint in the form script | The same endpoint as above. |

All three links point to `#` until the URL is set: both "read the design" buttons and the footer "Repository" link.

## Open questions

From brief section 10. Please answer before the page goes live.

1. The domain name, and whether "Talkative" is clear to use as a product name (trademark check).
2. When the repository goes public, and its URL.
3. The notify or follow mechanism, if any, and which service.
4. A logo or wordmark. Is there one? The page uses a text wordmark for now.
5. Whether to show a screenshot of the iOS app. None exists until the app milestone, so there is a placeholder until then.

## Copy and design decisions to check

- **Headline and subhead.** The headline reads: "Talk to your coding agent like a colleague — from anywhere, on hardware you own." It contains an em dash. Change it if you dislike them. The subhead reads: "Hold a real spoken conversation with Claude Code from your iPhone. Phone in your pocket, screen locked, earbuds in. Interrupt it whenever you like." Please check the wording.
- **FAQ App Store answer.** Brief section 7 gives an App Store answer. Brief section 8 says not to mention the App Store. The page keeps the section 7 answer, in the FAQ only. It is a plain "No". Please confirm.
- **"Read the design".** This button links to a placeholder for now.
- **Hero visual.** The hero uses the animated listening mark instead of a photo. A photo slot is left as a TODO.
- **Wordmark.** The primary lockup's wordmark looks closest to wordmark option A (Archivo Black). Please confirm.
- **Full-terminal look.** The whole page is a terminal, as you chose.
- **Vignette.** Lowered from the branding's 0.6 to 0.2, so text keeps WCAG AA contrast.
- **Phosphor flicker.** Runs in dark mode only, as in the branding, and only while the mark animates (see "Listening animation").
- **The form.** It does not send anything yet, and the note under it says it is a placeholder. The email input has no `name`, so even a forced submit carries no address. The button ships `disabled` and `mark.js` enables it, so without JavaScript the button stays off. With JavaScript, pressing it shows: "Not wired up yet. Check back here for news." It does not point at the repository, because the repository is private. Please check the wording.
- **Privacy section.** Rewritten so it claims no more than is true. Please check every line. The intro: "Talkative is private by default, and the agent host runs on your computer. Here is exactly what that means." The lists:
  - "Stays on your hardware, by default": "Your voice audio, unless you switch on a cloud speech engine." and "Speech recognition and speech output."
  - "What can leave, and when": "Traffic between your phone and your machines travels over your private Tailscale network.", "The text of what you say goes to Claude through Claude Code, with your normal login, as any Claude Code prompt does." and "Your audio, to a cloud speech engine, only if you explicitly switch one on."
- **Host operating system.** The page says "your computer" throughout and names no operating system. The brief rules out Windows and macOS hosts for the first version. Many iPhone owners will read "your computer" as a Mac. Please decide whether to say so. A suggested FAQ item:
  - "Which computers can run it?" Answer: yours to fill in. This is not in the page yet, and the guard tests ban "mac", "macOS" and "Windows" as words, so adjust them if your answer names one.
- **Transcript wording.** The illustrative exchange is: "How's the auth refactor going?" / "Two of three jobs are done. The third is running in the background, so I'm free to talk." / "Which files did the second job touch?" / "Mostly the session code. In short, it—" / "Never mind. Just tell me when the third one finishes." / "The third job just finished and the tests pass. I'd like to push the branch. Tap Approve on your phone." / "(taps Approve)". The dash on the agent's line shows you cutting it off. Please check it sounds like you.
- **"In development." in the hero.** A short line under the subhead, so the present-tense copy does not read as "available now".
- **"iPhone only" in the status line.** The FAQ status line reads "Status: in development. Not released yet. iPhone only." Please confirm you want "iPhone only" stated there as well as in the Android answer.
- **Brand name on phones.** Below 600px the ASCII wordmark would shrink to a 3px font and read as texture, so phones show the name "Talkative" as plain bold text in the accent colour, with the glow in dark mode. From 600px up the ASCII wordmark shows. Only one of the two is ever displayed, so screen readers hear the name once.
- **Listening animation.** It animates for at most 5 seconds each time the mark comes into view, then settles on the static mark (WCAG 2.2.2). The dark-mode flicker runs only during those 5 seconds. Hiding the tab pauses it. Reduced motion turns it off. If you want a longer loop, it needs a visible pause button.
- **The mark is driven by sound, as in the app.** `mark.js` carries ports of the app's `MarkRenderer` and `BandMeter`, so the page and the phone draw the same way from the same kind of input. The 5-second run is a scripted exchange: a synthetic voice "you" (listening), a slow low wave (thinking), then a lower synthetic voice answering (speaking). Each voice is synthesised speech-shaped sound (pitched harmonics through vowel formants, syllables, gaps, the odd consonant), measured by the band meter. A line under the mark names the mode.
- **"[ talk to it ]".** An opt-in button under the mark. It asks for the microphone and drives the mark from the visitor's voice through the same band meter. The audio goes from the microphone to an analyser in the tab and nowhere else. It stops on the button, when the tab is hidden, or after a minute. The button only appears when the browser allows microphone access, which needs HTTPS or localhost. Please check the note's wording: "Uses your microphone to move the mark. The sound stays in this page. Nothing is recorded or sent."
- **Headings.** The "## " before each section heading is drawn by CSS and hidden from screen readers, so they read just "privacy", not "hash hash privacy".
- **No latency figures.** There are no latency numbers anywhere, so there is no latency TODO.

## Accessibility notes

- Ratios use the WCAG 2.x formula.
- The dark "worst case" column comes from a per-pixel model of the actual CSS. It assumes the strongest glow, a scanline row, and the vignette. It is checked at five viewport sizes, from 360 by 740 to 2560 by 1300.
- Every pair passes its target.

In short: all text is readable in both light and dark mode.

Dark (`#0C0A07`)

| Pair | Plain on bg | On glow peak (#271909) | Under scanline row | Worst case, all effects | Needs |
|---|---|---|---|---|---|
| text `#FFE2A8` | 15.72 | 13.58 | 10.49 | 6.76 | 4.5 |
| accent `#FFC453` | 12.50 | 10.80 | 8.47 | 5.55 | 4.5 |
| muted `#D4B888` | 10.37 | 8.96 | 7.10 | 4.73 | 4.5 |
| border `#A88E60` | 6.31 | 5.45 | 4.47 | 3.14 | 3.0 |
| focus ring (accent) | 12.50 | 10.80 | 8.47 | 5.55 | 3.0 |
| inverse video `#0C0A07` on `#FFC453` | 12.50 | n/a | n/a | about 5.5 | 4.5 |

Light (`#F5EEE0`, no overlays, no glow)

| Pair | Ratio | Needs |
|---|---|---|
| text `#1B1409` | 15.81 | 4.5 |
| accent `#A85200` | 4.70 | 4.5 |
| muted `#6E5B3E` | 5.63 | 4.5 |
| border `#8F7A5C` | 3.56 | 3.0 |
| focus ring (accent) | 4.70 | 3.0 |
| inverse video `#F5EEE0` on `#A85200` | 4.70 | 4.5 |

## Font licence

The page uses JetBrains Mono v2.304, under the SIL Open Font License 1.1. The licence text is in `fonts/OFL.txt`. The fonts are self-hosted, so the page makes no third-party font request.
