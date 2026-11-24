import json

import numpy as np

from bench import prepare as prepare_mod
from bench.segment import segments_from_probs


def test_two_utterances_split_by_long_silence():
    p = [0.9] * 30 + [0.1] * 30 + [0.9] * 30  # 30 ms frames
    assert segments_from_probs(p, 30) == [(0, 900), (1800, 2700)]


def test_short_gap_does_not_split():
    p = [0.9] * 30 + [0.1] * 10 + [0.9] * 30  # 300 ms gap < 800 ms
    assert len(segments_from_probs(p, 30)) == 1


def test_short_blip_dropped():
    p = [0.1] * 30 + [0.9] * 5 + [0.1] * 30  # 150 ms of "speech": a clank
    assert segments_from_probs(p, 30) == []


def test_speech_running_to_end_is_closed():
    assert segments_from_probs([0.1] * 5 + [0.9] * 20, 30) == [(150, 750)]


def test_count_mismatch_leaves_unlabelled(tmp_path, monkeypatch, capsys):
    memo = tmp_path / "take1.m4a"
    memo.write_bytes(b"")
    sr = 16000
    monkeypatch.setattr(prepare_mod, "load_16k_mono", lambda p: np.zeros(sr * 100, np.float32))
    # 29 utterances of 1 s separated by 1 s of silence, 30 ms frames
    probs = ([0.9] * 34 + [0.1] * 34) * 29
    monkeypatch.setattr(prepare_mod, "vad_probs", lambda audio, rate: (probs, 30))
    out = tmp_path / "clips"

    result = prepare_mod.prepare(memo, out)

    assert result.labelled is False and result.count == 29
    assert len(result.clips) == 29
    manifest = out / "take1" / "manifest.json"
    data = json.loads(manifest.read_text())
    assert len(data) == 29 and all(v is None for v in data.values())
    assert "take1: found 29 utterances, expected 30" in capsys.readouterr().out
    assert (out / "take1" / "01.wav").exists()


def test_exact_count_labels_and_load_clips(tmp_path, monkeypatch):
    memo = tmp_path / "take2.m4a"
    memo.write_bytes(b"")
    monkeypatch.setattr(prepare_mod, "load_16k_mono", lambda p: np.full(16000 * 100, 0.1, np.float32))
    probs = ([0.9] * 34 + [0.1] * 34) * 30
    monkeypatch.setattr(prepare_mod, "vad_probs", lambda audio, rate: (probs, 30))
    out = tmp_path / "clips"

    result = prepare_mod.prepare(memo, out)

    assert result.labelled is True and result.count == 30
    data = json.loads((out / "take2" / "manifest.json").read_text())
    assert data["01.wav"] == 1 and data["30.wav"] == 30

    clips = prepare_mod.load_clips(out)
    assert len(clips) == 30
    assert clips[0].memo == "take2" and clips[0].line_id == 1
    assert clips[0].audio.dtype == np.float32 and clips[0].audio.ndim == 1
