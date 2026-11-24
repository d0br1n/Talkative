"""Speech-to-text engine adapters: faster-whisper and sherpa-onnx (Parakeet, Moonshine)."""

import os
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

import numpy as np

MODELS = Path(__file__).resolve().parent.parent / "models"
WHISPER_ROOT = MODELS / "faster-whisper"

# Project words from the reading card, passed to Whisper as initial_prompt.
VOCAB_PROMPT = (
    "LiveKit, Oracle, Kokoro, Piper, Whisper, Parakeet, Tailscale, SideStore, Sonnet, "
    "subagent, coordinator, refactor, worktree, rebase, Moonshine"
)


class ModelMissing(Exception):
    """Raised by `load()` when a model's files are absent."""

    def __init__(self, path: Path | str):
        super().__init__(f"model not found: {path}")
        self.path = Path(path)


class SttEngine(Protocol):
    name: str

    def load(self) -> None: ...

    def transcribe(self, audio: np.ndarray, prompt: str | None) -> str: ...


def _offline() -> bool:
    return os.environ.get("TALKATIVE_OFFLINE") == "1"


class WhisperEngine:
    """faster-whisper: float16 on CUDA when usable, otherwise int8 on CPU."""

    def __init__(self, size: str):
        self.name = f"whisper-{size}"
        self.size = size
        self.device = "unloaded"
        self._model = None

    def _build(self, device: str, compute_type: str, local_only: bool):
        from faster_whisper import WhisperModel

        return WhisperModel(
            self.size, device=device, compute_type=compute_type,
            download_root=str(WHISPER_ROOT), local_files_only=local_only,
        )

    def load(self) -> None:
        import ctranslate2

        local_only = _offline()
        try:
            if ctranslate2.get_cuda_device_count() > 0:
                try:
                    self._model = self._build("cuda", "float16", local_only)
                    self._warm_up()
                    self.device = "cuda"
                    return
                except Exception as exc:  # missing cuBLAS/cuDNN, out of memory, ...
                    if isinstance(exc, _not_cached_errors()):
                        raise
                    self._model = None
            self._model = self._build("cpu", "int8", local_only)
            self._warm_up()
            self.device = "cpu"
        except _not_cached_errors() as exc:
            if local_only:
                raise ModelMissing(WHISPER_ROOT / self.size) from exc
            raise

    def _warm_up(self) -> None:
        """CUDA libraries load lazily: run a tiny decode so failures surface in load()."""
        list(self._model.transcribe(np.zeros(8000, dtype=np.float32), beam_size=1, vad_filter=False)[0])

    def transcribe(self, audio: np.ndarray, prompt: str | None) -> str:
        segments, _ = self._model.transcribe(
            audio, language="en", beam_size=1, vad_filter=False, initial_prompt=prompt,
        )
        return " ".join(seg.text.strip() for seg in segments).strip()


def _not_cached_errors() -> tuple[type[Exception], ...]:
    from huggingface_hub.errors import LocalEntryNotFoundError

    return (LocalEntryNotFoundError, OSError)


class SherpaEngine:
    """sherpa-onnx offline recogniser on the CPU provider. Ignores the prompt."""

    def __init__(self, name: str, directory: str, build: Callable[[Path], object],
                 required: tuple[str, ...], threads: int = 4):
        self.name = name
        self.dir = MODELS / directory
        self.required = required
        self._build = build
        self.threads = threads
        self.device = "cpu"
        self._rec = None

    def load(self) -> None:
        if not self.dir.is_dir():
            raise ModelMissing(self.dir)
        for filename in self.required:
            if not (self.dir / filename).is_file():
                raise ModelMissing(self.dir / filename)
        self._rec = self._build(self.dir)

    def transcribe(self, audio: np.ndarray, prompt: str | None) -> str:
        stream = self._rec.create_stream()
        stream.accept_waveform(16000, audio)
        self._rec.decode_stream(stream)
        return stream.result.text.strip()


PARAKEET_FILES = ("encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt")
MOONSHINE_FILES = (
    "preprocess.onnx", "encode.int8.onnx", "uncached_decode.int8.onnx", "cached_decode.int8.onnx", "tokens.txt",
)


def _parakeet(threads: int):
    def build(d: Path):
        import sherpa_onnx

        return sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=str(d / "encoder.int8.onnx"), decoder=str(d / "decoder.int8.onnx"),
            joiner=str(d / "joiner.int8.onnx"), tokens=str(d / "tokens.txt"),
            num_threads=threads, model_type="nemo_transducer", provider="cpu",
        )
    return build


def _moonshine(threads: int):
    def build(d: Path):
        import sherpa_onnx

        return sherpa_onnx.OfflineRecognizer.from_moonshine(
            preprocessor=str(d / "preprocess.onnx"), encoder=str(d / "encode.int8.onnx"),
            uncached_decoder=str(d / "uncached_decode.int8.onnx"),
            cached_decoder=str(d / "cached_decode.int8.onnx"),
            tokens=str(d / "tokens.txt"), num_threads=threads, provider="cpu",
        )
    return build


ENGINES: dict[str, Callable[[], SttEngine]] = {
    **{f"whisper-{s}.en": (lambda s=s: WhisperEngine(f"{s}.en")) for s in ("tiny", "base", "small", "medium")},
    "parakeet-tdt-0.6b": lambda: SherpaEngine(
        "parakeet-tdt-0.6b", "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", _parakeet(4),
        PARAKEET_FILES),
    "moonshine-base": lambda: SherpaEngine(
        "moonshine-base", "sherpa-onnx-moonshine-base-en-int8", _moonshine(4),
        MOONSHINE_FILES),
}
