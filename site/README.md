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
- `mark.js`: the animated listening mark and the placeholder form handler.
- `fonts/JetBrainsMono-Regular.woff2`, `fonts/JetBrainsMono-Bold.woff2`: self-hosted font files.
- `fonts/OFL.txt`: the font licence.
- `README.md`: this file.

## Placeholders

Each `TODO(owner)` in the source, and what it needs.

| Where | What it is | What's needed |
|---|---|---|
| `site/index.html:38` | Hero photo slot | Optional. A photo, or leave the animated mark. |
| `site/index.html:57` | Notify form endpoint | Which service, and its URL. The form sends nothing now. |
| `site/index.html:64` | Repository URL, for the hero "read the design" button | The public repository URL, or the design document URL. |
| `site/index.html:214` | Repository URL, for the open source "read the design" button | The same URL. |
| `site/index.html:251` | Repository URL, footer "Repository" link | The public repository URL. |
| `site/mark.js:136` | Notify endpoint in the form script | The same endpoint as above. |

Both "read the design" buttons link to `#` until the URL is set.

## Open questions

From brief section 10. Please answer before the page goes live.

1. The domain name, and whether "Talkative" is clear to use as a product name (trademark check).
2. When the repository goes public, and its URL.
3. The notify or follow mechanism, if any, and which service.
4. A logo or wordmark. Is there one? The page uses a text wordmark for now.
5. Whether to show a screenshot of the iOS app. None exists until the app milestone, so there is a placeholder until then.

## Copy and design decisions to check

- **Headline and subhead.** The subhead reads: "Hold a real spoken conversation with Claude Code from your iPhone. Phone in your pocket, screen locked, earbuds in. Interrupt it whenever you like." Please check the wording.
- **FAQ App Store answer.** Brief section 7 gives an App Store answer. Brief section 8 says not to mention the App Store. The page keeps the section 7 answer, in the FAQ only. It is a plain "No". Please confirm.
- **"Read the design".** This button links to a placeholder for now.
- **Hero visual.** The hero uses the animated listening mark instead of a photo. A photo slot is left as a TODO.
- **Wordmark.** The primary lockup's wordmark looks closest to wordmark option A (Archivo Black). Please confirm.
- **Full-terminal look.** The whole page is a terminal, as you chose.
- **Vignette.** Lowered from the branding's 0.6 to 0.2, so text keeps WCAG AA contrast.
- **Phosphor flicker.** Runs in dark mode only, as in the branding.
- **The form.** It does not send anything yet. The page says so.
- **Privacy lists.** "Stays on your hardware" says the agent host runs on your computer. "What can leave" says Claude Code talks to Claude as normal.
- **No latency figures.** There are no latency numbers anywhere, so there is no latency TODO.

## Accessibility notes

- Ratios use the WCAG 2.x formula.
- The dark "worst case" column comes from a per-pixel model of the actual CSS. It assumes the strongest glow, a scanline row, and the vignette. It is checked at five viewport sizes, from 360 by 740 to 2560 by 1300.
- Every pair passes its target.

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
