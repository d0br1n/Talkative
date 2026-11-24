"""Text-to-speech adapters (sherpa-onnx Kokoro and Piper) timed to the first audio chunk."""

import time
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from bench.stt import MODELS, ModelMissing

MAX_TTS_FIRST_AUDIO_P50_S = 0.5
MEASUREMENT = (
    "time to first callback; engine is non-streaming, so this equals full-sentence synthesis "
    "(includes phonemisation for piper)"
)
WARMUP_SENTENCE = "Warming up the voice."
KOKORO_SPEAKER_ID = 1  # same voice as scripts/make_fixture.py


class TtsEngine(Protocol):
    name: str

    def load(self) -> None: ...

    def first_audio_s(self, sentence: str) -> float: ...


class SherpaTts:
    def __init__(self, name: str, directory: str, required: tuple[str, ...],
                 build: Callable[[Path], object], sid: int = 0):
        self.name = name
        self.dir = MODELS / directory
        self.required = required
        self._build = build
        self.sid = sid
        self.device = "cpu"
        self._tts = None

    def load(self) -> None:
        if not self.dir.is_dir():
            raise ModelMissing(self.dir)
        for filename in self.required:
            if not (self.dir / filename).exists():
                raise ModelMissing(self.dir / filename)
        self._tts = self._build(self.dir)
        self._generate(WARMUP_SENTENCE)  # untimed warm-up

    def _generate(self, sentence: str) -> float:
        """Seconds from the call to the first callback.

        The offline engines call back only after the whole sentence is synthesised, so this
        equals full-sentence synthesis time. The callback still returns 1 (keep going): stopping
        early would change nothing for these engines.
        """
        first: list[float] = []
        start = time.perf_counter()

        def on_chunk(samples, progress) -> int:
            if not first:
                first.append(time.perf_counter() - start)
            return 1

        self._tts.generate(sentence, sid=self.sid, speed=1.0, callback=on_chunk)
        if not first:
            raise RuntimeError(f"no audio produced for {sentence!r}")
        return first[0]

    def first_audio_s(self, sentence: str) -> float:
        return self._generate(sentence)


def _kokoro(d: Path):
    import sherpa_onnx

    return sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(d / "model.int8.onnx"), voices=str(d / "voices.bin"),
                tokens=str(d / "tokens.txt"), data_dir=str(d / "espeak-ng-data"),
                dict_dir=str(d / "dict"), lexicon=str(d / "lexicon-us-en.txt"), lang="en-us",
            ),
            num_threads=4, provider="cpu",
        )))


def _piper(d: Path):
    import sherpa_onnx

    return sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(d / "en_US-lessac-medium.onnx"), tokens=str(d / "tokens.txt"),
                data_dir=str(d / "espeak-ng-data"),  # sherpa-onnx 1.13.x phonemises with its own copy
            ),
            num_threads=4, provider="cpu",
        )))


TTS_ENGINES: dict[str, Callable[[], TtsEngine]] = {
    "kokoro": lambda: SherpaTts(
        "kokoro", "kokoro-int8-multi-lang-v1_0",
        ("model.int8.onnx", "voices.bin", "tokens.txt", "espeak-ng-data", "dict", "lexicon-us-en.txt"),
        _kokoro, sid=KOKORO_SPEAKER_ID),
    "piper-medium": lambda: SherpaTts(
        "piper-medium", "vits-piper-en_US-lessac-medium",
        ("en_US-lessac-medium.onnx", "tokens.txt", "espeak-ng-data"), _piper),
}
