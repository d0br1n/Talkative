# Talkative

Talkative lets you hold spoken conversations with a Claude Code coordinator from an iPhone, using self-hosted speech recognition and synthesis rather than a hosted speech service.

- Design specs: [docs/specs/](docs/specs/)
- Implementation plans: [docs/superpowers/plans/](docs/superpowers/plans/)
- Benchmarks (milestone 1): how to record, run and read them is in [Running the benchmark](docs/bench/CARD.md#running-the-benchmark).

## Development

- `bun install` installs the TypeScript dependencies (voice side and agent side).
- `bun test` runs the TypeScript tests.
- `uv sync` installs the Python benchmark environment; `uv run pytest -q` runs its tests.
