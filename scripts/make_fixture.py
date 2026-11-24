"""Synthesise tests/fixtures/stop.wav and sentence.wav with sherpa-onnx Kokoro (16 kHz mono).

Stand-in speech until the owner's recordings exist. Needs models/kokoro-int8-multi-lang-v1_0 (scripts/fetch_models.sh).
"""

from pathlib import Path

import numpy as np
import sherpa_onnx
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
KOKORO = ROOT / "models" / "kokoro-int8-multi-lang-v1_0"
OUT = ROOT / "tests" / "fixtures"
TARGET_RATE = 16000
SPEAKER_ID = 1  # voice 0 made whisper-small.en hear "stub"; 1 is transcribed correctly by every engine

# Kokoro's lexicon lacks "LiveKit", so it is spoken as "Live Kit"; the clip stands for the card sentence.
CLIPS = {
    "stop.wav": "stop",
    "sentence.wav": "Is the Live Kit server still running on the Oracle box?",
}


def resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    n = int(round(len(x) * dst / src))
    return np.interp(np.linspace(0, len(x), n, endpoint=False), np.arange(len(x)), x).astype(np.float32)


def main() -> None:
    if not KOKORO.is_dir():
        raise SystemExit(f"{KOKORO} missing: run scripts/fetch_models.sh")
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(KOKORO / "model.int8.onnx"),
                voices=str(KOKORO / "voices.bin"),
                tokens=str(KOKORO / "tokens.txt"),
                data_dir=str(KOKORO / "espeak-ng-data"),
                dict_dir=str(KOKORO / "dict"),
                lexicon=str(KOKORO / "lexicon-us-en.txt"),
                lang="en-us",
            ),
            num_threads=2,
            provider="cpu",
        )
    )
    tts = sherpa_onnx.OfflineTts(config)
    OUT.mkdir(parents=True, exist_ok=True)
    for filename, text in CLIPS.items():
        audio = tts.generate(text, sid=SPEAKER_ID, speed=1.0)
        samples = resample(np.asarray(audio.samples, dtype=np.float32), audio.sample_rate, TARGET_RATE)
        pad = np.zeros(TARGET_RATE // 4, dtype=np.float32)  # quarter second of silence each side
        sf.write(OUT / filename, np.concatenate([pad, samples, pad]), TARGET_RATE, subtype="PCM_16")
        print(f"wrote {OUT / filename} ({len(samples) / TARGET_RATE:.2f}s): {text}")


if __name__ == "__main__":
    main()
