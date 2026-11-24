"""Text-to-speech adapters (sherpa-onnx Kokoro and Piper) timed to the first audio chunk."""

import time
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from bench.stt import MODELS, ModelMissing

MAX_TTS_FIRST_AUDIO_P50_S = 0.5
WARMUP_SENTENCE = "Warming up the voice."
KOKORO_SPEAKER_ID = 1  # same voice as scripts/make_fixture.py


class TtsEngine(Protocol):
    name: str

    def load(self) -> None: ...

    def first_audio_s(self, sentence: str) -> float: ...


class SherpaTts:
    def __init__(self, name: str, directory: str, required: tuple[str, ...],
                 build: Callable[[Path], object], sid: int = 0,
                 phonemizer: Callable[[Path], Callable[[str], list[list[int]]]] | None = None):
        self.name = name
        self.dir = MODELS / directory
        self.required = required
        self._build = build
        self.sid = sid
        self._make_phonemizer = phonemizer
        self._phonemize: Callable[[str], list[list[int]]] | None = None
        self.device = "cpu"
        self._tts = None

    def load(self) -> None:
        if not self.dir.is_dir():
            raise ModelMissing(self.dir)
        for filename in self.required:
            if not (self.dir / filename).exists():
                raise ModelMissing(self.dir / filename)
        self._tts = self._build(self.dir)
        if self._make_phonemizer:
            self._phonemize = self._make_phonemizer(self.dir)
        self._generate(WARMUP_SENTENCE)  # untimed warm-up

    def _generate(self, sentence: str) -> float:
        """Seconds from the call to the first PCM chunk; stops generating after that chunk."""
        first: list[float] = []
        start = time.perf_counter()

        def on_chunk(samples, progress) -> int:
            if not first:
                first.append(time.perf_counter() - start)
            return 0  # stop: the rest of the sentence is not needed

        if self._phonemize:  # phonemising is part of the time to first audio
            import sherpa_onnx

            config = sherpa_onnx.GenerationConfig()
            config.sid = self.sid
            config.phoneme_codepoints = self._phonemize(sentence)
            self._tts.generate(sentence, config, callback=on_chunk)
        else:
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
            ),
            num_threads=4, provider="cpu",
        )))


def _espeak_phonemizer(d: Path) -> Callable[[str], list[list[int]]]:
    """IPA phoneme codepoints via the system libespeak-ng (sherpa-onnx >= 2.0 dropped its built-in one).

    Piper voices are trained on espeak-ng IPA, so this matches the voice's frontend, minus punctuation.
    """
    import ctypes

    lib = ctypes.CDLL("libespeak-ng.so.1")
    if lib.espeak_Initialize(2, 0, str(d / "espeak-ng-data").encode(), 0) < 0:
        raise RuntimeError("espeak_Initialize failed")
    lib.espeak_SetVoiceByName(b"en-us")
    lib.espeak_TextToPhonemes.restype = ctypes.c_char_p

    def phonemize(text: str) -> list[list[int]]:
        buf = ctypes.c_char_p(text.encode())
        clauses: list[list[int]] = []
        while buf.value:
            ipa = lib.espeak_TextToPhonemes(ctypes.byref(buf), 1, 0x02)  # UTF-8 in, IPA out
            if ipa:
                clauses.append([ord(c) for c in ipa.decode()])
        return clauses

    return phonemize


TTS_ENGINES: dict[str, Callable[[], TtsEngine]] = {
    "kokoro": lambda: SherpaTts(
        "kokoro", "kokoro-int8-multi-lang-v1_0",
        ("model.int8.onnx", "voices.bin", "tokens.txt", "espeak-ng-data", "dict", "lexicon-us-en.txt"),
        _kokoro, sid=KOKORO_SPEAKER_ID),
    "piper-medium": lambda: SherpaTts(
        "piper-medium", "vits-piper-en_US-lessac-medium",
        ("en_US-lessac-medium.onnx", "tokens.txt", "espeak-ng-data"), _piper,
        phonemizer=_espeak_phonemizer),
}
