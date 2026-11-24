#!/usr/bin/env bash
# Download the models the benchmarks need into models/. Idempotent: existing files are skipped.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models

SHERPA=https://github.com/k2-fsa/sherpa-onnx/releases/download

# "<destination under models/> <url>"
DOWNLOADS=(
  "silero_vad.onnx $SHERPA/asr-models/silero_vad.onnx"
)

for entry in "${DOWNLOADS[@]}"; do
  dest="models/${entry%% *}"
  url="${entry#* }"
  if [[ -e "$dest" ]]; then
    echo "skip $dest (exists)"
    continue
  fi
  echo "fetch $dest"
  curl -fL --retry 3 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
done
