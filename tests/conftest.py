import json
import time
from pathlib import Path

import numpy as np
import pytest

from bench.prepare import LabelledClip


class FakeEngine:
    """First call sleeps 0.7 s (a cold start), later calls 0.1 s."""

    name = "fake"
    device = "cpu"

    def __init__(self):
        self.calls = 0

    def load(self) -> None:
        pass

    def transcribe(self, audio, prompt):
        time.sleep(0.7 if self.calls == 0 else 0.1)
        self.calls += 1
        return "stop"


@pytest.fixture
def fake_engine():
    return FakeEngine()


@pytest.fixture
def clips():
    audio = np.zeros(1600, dtype=np.float32)
    ids = [1, 2, 3, None]
    return [LabelledClip("memo", Path(f"{i}.wav"), line_id, audio) for i, line_id in enumerate(ids)]


def _stt(engine, passing):
    return {
        "engine": engine, "device": "cpu", "host": "h", "status": "ok",
        "rows": [], "wer_ordinary": 0.05 if passing else 0.4,
        "command_rate": 1.0 if passing else 0.5, "decode_p50": 0.3, "decode_p95": 0.5,
        "passes": passing, "reasons": [] if passing else ["WER 0.400 above the 0.10 bar"],
        "peak_rss_mb": 500.0, "peak_vram_mb": None, "skipped_unlabelled": 0,
    }


@pytest.fixture
def results_dir_with_one_passing_one_failing(tmp_path):
    (tmp_path / "good.json").write_text(json.dumps(_stt("good", True)))
    (tmp_path / "bad.json").write_text(json.dumps(_stt("bad", False)))
    (tmp_path / "tts-kokoro.json").write_text(json.dumps({
        "engine": "kokoro", "kind": "tts", "host": "h", "status": "ok", "sentences": [],
        "first_audio_p50": 0.2, "first_audio_p95": 0.3, "passes": True,
    }))
    (tmp_path / "broken.json").write_text(json.dumps(
        {"engine": "broken", "kind": "stt", "status": "failed: MemoryError: oom"}))
    return tmp_path
