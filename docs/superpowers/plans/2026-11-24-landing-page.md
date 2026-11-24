# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single static, full-terminal-styled landing page for Talkative in `site/`, light and dark, phone-first, that obeys the brief's binding claims rules.

**Architecture:** Hand-written `index.html` + `styles.css` + one vanilla `mark.js` (listening animation, diagram toggle, placeholder form). Fonts self-hosted. A stdlib-only pytest file guards the brief's binding rules against future copy edits.

**Tech Stack:** HTML, CSS (custom properties, `prefers-color-scheme`, `prefers-reduced-motion`), vanilla JS, pytest + `html.parser`.

**Spec:** `docs/superpowers/specs/2026-11-24-landing-page-design.md`, with content and binding rules from `docs/briefs/landing-page.md`.

## Global Constraints

- Nothing on the page may load from another host: no CDN, no Google Fonts, no analytics, no iframes or embeds.
- Footer line, verbatim: "Talkative is an independent open-source project and is not affiliated with Anthropic."
- Never use: latency or accuracy numbers, "available now", download/App Store claims (the FAQ answer "No" is the only App Store mention), "completely private", "end-to-end encrypted", hype words, testimonials or counts, named third-party projects (Tailscale is allowed because the brief names it as the user's network), or Android/Windows/macOS host support.
- The Anthropic name appears only in the footer line and the FAQ answer "not affiliated with Anthropic". "Claude Code" is used only to say what Talkative works with.
- Placeholders are written as `TODO(owner)`: repository URL, notify endpoint, hero photo. No latency figure is used, so there is no latency TODO.
- Brand colours. Dark: bg `#0C0A07`, text `#FFE2A8`, accent `#FFC453`. Light: bg `#F5EEE0`, ink `#1B1409`, accent `#A85200`. Font: JetBrains Mono.
- No horizontal scroll at a 360px width, and every animation stops under `prefers-reduced-motion: reduce`.

## Review Focus

- **Phone width (360–390px):** the ASCII wordmark and the diagram must fit with no sideways scroll. Covered by the Task 5 browser check.
- **JS disabled:** the hero shows a static mark, both diagrams are readable (the split setup is shown by default), and the form explains that it isn't wired up. Covered by the Task 1 test (static mark text present in the HTML) and the Task 5 check.
- **Screen reader:** no ASCII art is read out, and each diagram has a list equivalent. Covered by the Task 1 test `test_ascii_art_hidden_from_screen_readers`.
- **Future copy edits re-introducing a banned claim.** Covered by the Task 1 tests.
- **Fonts missing or blocked:** the page falls back to the system monospace font without a layout break. Covered by the Task 5 check with the fonts folder renamed.

---

### Task 1: Rule-guard tests and page markup

**Files:**
- Create: `tests/test_site.py`
- Create: `site/index.html`

**Interfaces:**
- Produces:
  - **IDs:** `#main`, `#hero-mark` (a `<pre>` holding the static first frame), `#diagram-split`, `#diagram-local`.
  - **Classes and data attributes:** toggle buttons `[data-diagram="split"|"local"]` with `aria-pressed`, the `.card` class (6 instances), `.transcript` (an `<ol>`, one `<li>` per line), and the `[data-notify-form]` form.
  - **Stylesheet:** `styles.css` is linked from `index.html`.
  - **Script:** `mark.js`, loaded with `defer`.

- [ ] **Step 1: Write the failing tests in `tests/test_site.py`.** Read `site/index.html`, `site/styles.css` and `site/mark.js` as text, and parse the HTML with `html.parser`.
  - `test_no_external_requests`: no `http://` or `https://` in any of the three files, and no `<iframe>`.
  - `test_banned_claims_absent`: run a case-insensitive search of the visible text (tags stripped) for these terms, and get no hits:
    - "available now"
    - "download"
    - "completely private"
    - "end-to-end"
    - "revolutionary"
    - "ai-powered"
    - "sub-second"
    - "testimonial"
    - "sidetone"
    - "livekit"
    - "whisper"
    - "sherpa"
    - "windows"
    - "macos"

    Also no match for the regex `\b\d+(\.\d+)?\s?(ms|milliseconds?|seconds?)\b`.
  - `test_app_store_only_in_faq`: "app store" appears only inside the `<details>` element whose `<summary>` is "Is it in the App Store?".
  - `test_anthropic_mentions_limited`: every sentence containing "Anthropic" is either the footer line or contains "not affiliated with Anthropic".
  - `test_footer_line_verbatim`: the footer line from Global Constraints is present.
  - `test_owner_todos_present`: the strings `TODO(owner): repository URL`, `TODO(owner): notify endpoint` and `TODO(owner): hero photo` are all present in `index.html`.
  - `test_transcript_is_short_and_marked`: `.transcript` has between 1 and 8 `<li>` items, and the text "Illustrative" appears within the transcript section.
  - `test_six_cards`: there are exactly 6 elements with class `card`.
  - `test_ascii_art_hidden_from_screen_readers`: every `<pre>` has `aria-hidden="true"`, and its parent has `role="img"` and an `aria-label`. Exception: `.transcript` is a list, not a `<pre>`.
  - `test_document_basics`: `<html lang="en">`, exactly one `<h1>`, a skip link pointing to `#main`, a `<meta name="viewport">`, and a `<meta name="color-scheme" content="light dark">`.
- [ ] **Step 2:** Run `uv run pytest tests/test_site.py -v`. Expected: FAIL (the files don't exist yet).
- [ ] **Step 3: Write `site/index.html`.** Follow the section order in the spec, using copy from brief sections 1, 3, 4 and 7.
  - Headline: "Talk to your coding agent like a colleague — from anywhere, on hardware you own."
  - The wordmark and mark ASCII art are copied from the branding export (primary lockup). Pass this to an implementer as the path `<scratchpad>/branding-zip/Main.dc.html`, and decode `&amp;` while copying.
  - The six card titles come verbatim from brief section 3.
  - The FAQ is 6 `<details>` elements using brief section 7.
  - Mark the hero photo slot with an HTML comment.
- [ ] **Step 4:** Run `uv run pytest tests/test_site.py -v`. Expected: all pass.
- [ ] **Step 5:** Commit with `git add tests/test_site.py site/index.html && git commit -m "feat(site): landing page markup with rule-guard tests"`.

### Task 2: Terminal stylesheet

**Files:** Create `site/styles.css`.

**Interfaces:**
- Consumes the IDs and classes from Task 1.
- Produces the custom properties `--bg`, `--text`, `--accent`, `--muted`, `--border` and `--glow`.

- [ ] **Step 1: Colour tokens.**
  - Define the tokens on `:root` for light mode.
  - Redefine them under `@media (prefers-color-scheme: dark)` with the dark values from Global Constraints.
  - Choose `--muted` and `--border` so muted text is at least 4.5:1 against `--bg` in both themes. Check with any contrast calculator and record the ratios in the Task 4 README.
- [ ] **Step 2: Fonts.** Add `@font-face` rules for `fonts/JetBrainsMono-Regular.woff2` (400) and `fonts/JetBrainsMono-Bold.woff2` (700) with `font-display: swap`. The font stack is `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`.
- [ ] **Step 3: Dark-only effects.**
  - A fixed `body::before` scanline overlay (`repeating-linear-gradient`, 1px dark / 2px clear, `rgba(0,0,0,.18)`).
  - A fixed `body::after` vignette.
  - Both get `pointer-events: none`, and both are removed in light mode.
  - The glow `text-shadow` from the branding goes on the mark, the wordmark and `h1`/`h2`. Body text gets at most `0 0 1px`.
- [ ] **Step 4: Layout.**
  - Single column, `max-width: 70ch`, side padding of 16px or more.
  - Wordmark `font-size: clamp(3px, 0.62vw, 9px)` so its ~150 columns fit a 360px screen. The mark gets a similar clamp.
  - `.card` panels have 1px `--border` borders.
  - Prompt prefixes (`you ›` and `talkative ›`) are spans styled in `--accent`.
  - Buttons render as `[ label ]`, with visible `:focus-visible` outlines in `--accent`.
- [ ] **Step 5: Motion.** Add the `phosphor` keyframes from the branding, applied to the mark. Under `prefers-reduced-motion: reduce`, set `animation: none`.
- [ ] **Step 6:** Run `uv run pytest tests/test_site.py -v`. Expected: still passing (this checks that `styles.css` has no external URLs).
- [ ] **Step 7:** Commit with `git commit -m "feat(site): terminal stylesheet, light and dark"`.

### Task 3: Behaviour script

**Files:** Create `site/mark.js`.

**Interfaces:**
- Consumes `#hero-mark`, the `[data-diagram]` buttons, `#diagram-split`, `#diagram-local` and `[data-notify-form]`.

- [ ] **Step 1: Listening animation.** Port `frame(t)` from the branding's `Animated.dc.html` as a plain function `frame(t: number): string`. Use the same constants: 14 bars, 15 rows, the same character ramps and the same hash. Every 90 ms, write the result to `#hero-mark.textContent`. Don't start under reduced motion, and pause while `document.hidden`.
- [ ] **Step 2: Diagram toggle.**
  - Clicking a button shows its diagram, hides the other one (`hidden` attribute) and updates `aria-pressed`.
  - Without JS, both diagrams are visible, each with its own heading. The script hides the "local" diagram on load.
- [ ] **Step 3: Placeholder form.** On submit, call `preventDefault()` and write into the form's `role="status"` element: "Not wired up yet. Watch the repository for news." Leave the `TODO(owner): notify endpoint` comment in place.
- [ ] **Step 4:** Run `uv run pytest tests/test_site.py -v`. Expected: pass.
- [ ] **Step 5:** Commit with `git commit -m "feat(site): listening animation, diagram toggle, placeholder form"`.

### Task 4: Fonts and README

**Files:**
- Create `site/fonts/JetBrainsMono-Regular.woff2`, `site/fonts/JetBrainsMono-Bold.woff2` and `site/fonts/OFL.txt`.
- Create `site/README.md`.

- [ ] **Step 1: Fonts.** Take the font files from the official JetBrains Mono GitHub release zip (`webfonts/` folder), along with `OFL.txt`. The owner approved this download.
- [ ] **Step 2: `site/README.md`.** It should cover:
  - How to view the page locally: `python3 -m http.server -d site`.
  - Every `TODO(owner)`, where it is, and what's needed.
  - The brief's open questions 1–5.
  - Copy decisions for the owner to check:
    - The wording of the headline and subhead.
    - The FAQ App Store answer, which conflicts with the brief's §8.
    - "Read the design" pointing to a placeholder.
    - The use of the animated mark instead of a photo.
    - Which wordmark option was used.
  - The contrast ratios measured in Task 2.
- [ ] **Step 3:** Commit with `git commit -m "docs(site): self-hosted fonts and owner README"`.

### Task 5: Browser verification

- [ ] **Step 1:** Serve `site/` locally and open it in the in-app browser.
- [ ] **Step 2:** At a width of 375px, in both the light and dark schemes, check that there's no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`) and take a screenshot.
- [ ] **Step 3:** Check the network log: every request goes to the local origin.
- [ ] **Step 4:** Tab through the page. Focus should be visible on the skip link, the CTAs, the toggle and the FAQ.
- [ ] **Step 5:** Rename `site/fonts` temporarily and reload. The layout should hold with the system monospace font. Then restore the folder.
- [ ] **Step 6:** Run `uv run pytest -q`. The whole suite should pass.
