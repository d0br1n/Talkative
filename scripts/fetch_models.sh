#!/usr/bin/env bash
# Download the models the benchmarks need into models/. Idempotent: existing files are skipped.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models

SHERPA=https://github.com/k2-fsa/sherpa-onnx/releases/download

# Sherpa-onnx model archives, extracted into models/ ("<directory the archive creates> <url>").
ARCHIVES=(
  "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 $SHERPA/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"
  "sherpa-onnx-moonshine-base-en-int8 $SHERPA/asr-models/sherpa-onnx-moonshine-base-en-int8.tar.bz2"
  "kokoro-int8-multi-lang-v1_0 $SHERPA/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2"
  "vits-piper-en_US-lessac-medium $SHERPA/tts-models/vits-piper-en_US-lessac-medium.tar.bz2"
)

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
  curl -fsSL --retry 3 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
done

for entry in "${ARCHIVES[@]}"; do
  dir="models/${entry%% *}"
  url="${entry#* }"
  if [[ -d "$dir" ]]; then
    echo "skip $dir (exists)"
    continue
  fi
  echo "fetch $dir"
  curl -fsSL --retry 3 -o "$dir.tar.bz2.part" "$url"
  # Extract beside the target, then rename: an interrupted run never leaves a partial $dir behind.
  tmp="$(mktemp -d models/.extract.XXXXXX)"
  tar -xjf "$dir.tar.bz2.part" -C "$tmp"
  mv "$tmp/$(basename "$dir")" "$dir"
  rmdir "$tmp"
  rm "$dir.tar.bz2.part"
done
