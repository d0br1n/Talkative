# Landing page design (short)

Source of truth for content and binding rules: `docs/briefs/landing-page.md`. This doc only records how the page is built and what it looks like.

## Intent

One static page that tells Claude Code users they can keep talking to their coding agent while away from the desk, on hardware they own. It invites them to follow development. Most visitors arrive on a phone.

## Goals, non-goals, anti-goals

- **Goals:** cover every section of the brief, in order; read well on a phone; work in light and dark; use the owner's branding (the ASCII voice-bar mark and wordmark).
- **Non-goals:** a working notify backend, a multi-page site, a CMS, a manual theme switch (the page follows the system setting).
- **Anti-goals:** anything in the brief's "Claims you may not make" section. Also any request to a third party when the page loads, including fonts and CDNs.

## Approaches

1. **Plain HTML and CSS, plus one small vanilla-JS file (chosen).** There's nothing to install and it hosts anywhere. The branding is already HTML and CSS, so it carries over directly.
2. **A static-site generator (Astro, 11ty).** It would add a Node toolchain to a Python repo for a single page. Worth it only once there's a second page.
3. **Reusing the branding export's React runtime.** That's about 190 KB of JS to draw a logo, so no. The listening animation is about 60 lines of plain JS once ported.

## Look: full terminal (owner's choice)

- **Dark mode:** a "phosphor monitor". Background `#0C0A07` with the soft amber radial glow. Text is `#FFE2A8`, accent and headings are `#FFC453`, muted text is a dimmer amber that is checked to pass WCAG AA. Scanlines and a vignette sit in a fixed overlay that ignores pointer events. A strong glow is used on the mark and headings only. Body text gets at most a faint glow so it stays sharp.
- **Light mode:** an "amber printout". Cream `#F5EEE0`, ink `#1B1409`, accent `#A85200`, with no scanlines or glow (as in the light lockup).
- **Type:** JetBrains Mono everywhere, self-hosted (regular and bold woff2 files, plus the OFL licence). The body is about 16–17px with line-height 1.6 and lines under 70 characters.
- **Motion:** the phosphor flicker on the mark and the listening animation. Both stop under `prefers-reduced-motion`.
- **Terminal idioms, used lightly:** section labels as `## the problem`. Cards are panels with 1px borders in the style of box-drawing characters. The transcript uses `you ›` and `talkative ›` prompts. Buttons look like `[ follow development ]`. The voice stays plain English: no fake shell commands that a reader might try to run.

## Sections (the brief's order)

1. **Hero:** the ASCII wordmark, then the headline and subhead. Below them sits the animated voice-bar mark as the hero visual, which falls back to a static frame without JS. The primary CTA is a placeholder email form (it doesn't submit anywhere and says so). The secondary CTA is "Read the design". The photo slot stays a `TODO(owner)` comment.
2. **The problem:** two lines.
3. **The transcript:** 7–8 lines, labelled "Illustrative".
4. **Six cards** for the six points.
5. **How it works:** a vertical ASCII box diagram that fits a 375px-wide screen. A two-button toggle switches between "Split setup" and "One machine". Each diagram is `aria-hidden` and has an equivalent ordered list for screen readers.
6. **Privacy:** two plain lists, "Stays on your hardware" and "What can leave, and when".
7. **Open source:** MIT, with the repo link as `TODO(owner)`.
8. **Status and FAQ:** a status line, then the FAQ as `<details>` elements.
9. **Footer:** the non-affiliation line, licence, and repo placeholder.

## Accessibility

- The ASCII art is `aria-hidden` and wrapped in `role="img"` with a label.
- Semantic headings and landmarks, plus a skip link.
- Visible focus styles.
- Contrast checked in both themes.
- The wordmark scales with the viewport so it never scrolls sideways.

## Files

All files live in `site/`:

- `index.html`
- `styles.css`
- `mark.js`
- `fonts/` (`JetBrainsMono-Regular.woff2`, `JetBrainsMono-Bold.woff2`, `OFL.txt`)
- `README.md`, which lists every `TODO(owner)` and every copy decision for the owner to check.

## Left to the builder

- Exact copy within the brief's limits. Copy decisions get listed in the README.
- The exact muted and border colours, provided they pass contrast.

## Verification

- Open the page locally at 375px and desktop widths, in both colour schemes.
- Confirm the network panel shows no requests outside the site.
- Tab through the page.
- Search the copy for the brief's banned claims.
