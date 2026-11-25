# Talkative

Talkative lets you hold spoken conversations with a Claude Code coordinator from an iPhone, using self-hosted speech recognition and synthesis rather than a hosted speech service.

- Design specs: [docs/specs/](docs/specs/)
- Implementation plans: [docs/superpowers/plans/](docs/superpowers/plans/)
- Benchmarks (milestone 1): how to record, run and read them is in [Running the benchmark](docs/bench/CARD.md#running-the-benchmark).

## Getting started

[deploy/README.md](deploy/README.md) takes a clean clone to a working setup: prerequisites (Bun,
uv, Docker, Tailscale, Claude Code logged in), `bun install`, `uv sync`, the speech models,
`bun src/main.ts init`, LiveKit, running `voice` and `agent` by hand and then as systemd user
units (with `loginctl enable-linger`), a check with the fake phone, and the split shape with the
agent on a laptop. In short, on one machine:

    bun install && uv sync && scripts/fetch_models.sh
    bun src/main.ts init --bind "$(tailscale ip -4)" --project <dir>
    bun src/main.ts livekit          # then run the docker command it prints
    bun src/main.ts voice            # one terminal
    bun src/main.ts agent            # another
    bun scripts/fake-phone.ts --pair "http://$(tailscale ip -4):7890" --code "$(bun src/main.ts code)" \
      --text "What is two plus two?" --wait 30

[test/e2e/README.md](test/e2e/README.md) runs the whole system end to end, with a fake Claude.

## iPhone app

The app is built unsigned in CI and installed with SideStore on a free Apple ID.

- [docs/ios/install.md](docs/ios/install.md): installing it and pairing with the voice side.
- [docs/ios/device-checklist.md](docs/ios/device-checklist.md): what to check on a real iPhone.

## Development

- `bun install` installs the TypeScript dependencies (voice side and agent side).
- `bun test` runs the TypeScript tests.
- `scripts/swift-test` runs the Swift core package tests on Linux in Docker (no Mac needed).
- `uv sync` installs the Python benchmark environment; `uv run pytest -q` runs its tests.
