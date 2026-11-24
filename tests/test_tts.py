import pytest

from bench.tts import MAX_TTS_FIRST_AUDIO_P50_S, TTS_ENGINES
from bench.stt import ModelMissing


def test_bar_value():
    assert MAX_TTS_FIRST_AUDIO_P50_S == 0.5
    assert set(TTS_ENGINES) == {"kokoro", "piper-medium"}


@pytest.fixture(params=sorted(TTS_ENGINES))
def tts_engine(request):
    eng = TTS_ENGINES[request.param]()
    try:
        eng.load()
    except (ModelMissing, OSError) as exc:
        pytest.skip(f"{request.param} unavailable: {exc}")
    return eng


def test_tts_first_audio_positive(tts_engine):
    assert 0 < tts_engine.first_audio_s("Short first sentence.") < 30
