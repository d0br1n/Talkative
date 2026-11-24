#!/usr/bin/env bash
# Run every STT and TTS engine, one process each, then write the per-host report.
# Usage: scripts/run_all.sh <host>      (STT needs clips/ from `python -m bench.prepare`)
set -u
host="${1:?usage: scripts/run_all.sh <host>}"
cd "$(dirname "$0")/.."
mkdir -p "results/$host" docs/bench

stt=$(uv run python -c "from bench.stt import ENGINES; print(*ENGINES)")
tts=$(uv run python -c "from bench.tts import TTS_ENGINES; print(*TTS_ENGINES)")

if ! compgen -G "clips/*/manifest.json" > /dev/null; then
  echo "No clips/*/manifest.json found: skipping the STT runs (TTS still runs)." >&2
  echo "Record the memos and run: uv run python -m bench.prepare recordings/*.m4a clips/" >&2
  echo "(see 'Running the benchmark' in docs/bench/CARD.md)" >&2
  stt=""
fi

for e in $stt; do
  echo "== stt $e"
  uv run python -m bench.run guard --kind stt --engine "$e" --host "$host" --out "results/$host/$e.json" -- \
    uv run python -m bench.run stt --clips clips/ --engine "$e" --host "$host" --out "results/$host/$e.json"
done
for e in $tts; do
  echo "== tts $e"
  uv run python -m bench.run guard --kind tts --engine "$e" --host "$host" --out "results/$host/$e.json" -- \
    uv run python -m bench.run tts --engine "$e" --host "$host" --out "results/$host/$e.json"
done

uv run python -m bench.report "results/$host/" > "docs/bench/results-$host.md"
echo "wrote docs/bench/results-$host.md"
