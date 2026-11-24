from pathlib import Path

import pytest

from bench.audio import load_16k_mono
from bench.score import normalise
from bench.stt import ENGINES, VOCAB_PROMPT, ModelMissing

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def fixture_clip():
    return load_16k_mono(FIXTURES / "stop.wav")


@pytest.mark.parametrize("name", list(ENGINES))
def test_engine_transcribes_fixture(name, fixture_clip):
    eng = ENGINES[name]()
    try:
        eng.load()
    except ModelMissing:
        pytest.skip(f"{name} not downloaded")
    text = eng.transcribe(fixture_clip, VOCAB_PROMPT)
    assert "stop" in normalise(text)
