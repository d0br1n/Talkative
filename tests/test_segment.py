import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from bench import prepare as prepare_mod
from bench.segment import segments_from_probs


def test_two_utterances_split_by_long_silence():
    p = [0.9] * 30 + [0.1] * 30 + [0.9] * 30  # 30 ms frames
    assert segments_from_probs(p, 30) == [(0, 900), (1800, 2700)]


def test_short_gap_does_not_split():
    p = [0.9] * 30 + [0.1] * 10 + [0.9] * 30  # 300 ms gap < 800 ms
    assert len(segments_from_probs(p, 30)) == 1


def test_short_blip_dropped():
    p = [0.1] * 30 + [0.9] * 4 + [0.1] * 30  # 120 ms of "speech": a clank
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


FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
@pytest.mark.skipif(not prepare_mod.VAD_MODEL.exists(), reason="models/silero_vad.onnx missing")
def test_one_word_command_survives_real_prepare(tmp_path):
    sil = tmp_path / "sil.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2", str(sil)],
        check=True,
    )
    sentence, stop = FIXTURES / "sentence.wav", FIXTURES / "stop.wav"
    parts = [sentence, sil, stop, sil, sentence]
    memo = tmp_path / "memo.wav"
    cmd = ["ffmpeg", "-v", "error"]
    for part in parts:
        cmd += ["-i", str(part)]
    inputs = "".join(f"[{i}:a]" for i in range(len(parts)))
    cmd += ["-filter_complex", f"{inputs}concat=n={len(parts)}:v=0:a=1[o]", "-map", "[o]",
            "-ar", "16000", "-ac", "1", str(memo)]
    subprocess.run(cmd, check=True)

    result = prepare_mod.prepare(memo, tmp_path / "clips")

    assert result.count == 3


def _write_manifest(tmp_path, manifest):
    import soundfile as sf

    folder = tmp_path / "memo"
    folder.mkdir()
    for name in manifest:
        sf.write(folder / name, np.zeros(1600, np.float32), 16000)
    (folder / "manifest.json").write_text(json.dumps(manifest))


@pytest.mark.parametrize("bad", [0, 31, "3", 2.5, True])
def test_load_clips_rejects_bad_ids(tmp_path, bad):
    _write_manifest(tmp_path, {"01.wav": 1, "02.wav": bad})
    with pytest.raises(ValueError) as exc:
        prepare_mod.load_clips(tmp_path)
    assert "manifest.json" in str(exc.value) and repr(bad) in str(exc.value)


def test_load_clips_accepts_null_and_bounds(tmp_path):
    _write_manifest(tmp_path, {"01.wav": 1, "02.wav": 30, "03.wav": None})
    assert [c.line_id for c in prepare_mod.load_clips(tmp_path)] == [1, 30, None]


def _sine_memo(path):
    t = np.arange(16000 * 3) / 16000
    import soundfile as sf

    sf.write(path, (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), 16000)


def _cli(*args):
    import sys

    return subprocess.run([sys.executable, "-m", "bench.prepare", *map(str, args)],
                          capture_output=True, text=True)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
@pytest.mark.skipif(not prepare_mod.VAD_MODEL.exists(), reason="models/silero_vad.onnx missing")
def test_cli_without_labels_exits_nonzero_and_refuses_overwrite(tmp_path):
    memo, out = tmp_path / "tone.wav", tmp_path / "clips"
    _sine_memo(memo)
    first = _cli(memo, out)
    assert first.returncode == 1
    assert "tone: found 0 utterances, expected 30" in first.stdout
    manifest = out / "tone" / "manifest.json"
    manifest.write_text('{"edited": 1}')  # a manual fix the re-run must not destroy

    second = _cli(memo, out)
    assert second.returncode == 2 and "--force" in second.stdout
    assert manifest.read_text() == '{"edited": 1}'

    (out / "tone" / "99.wav").write_bytes(b"orphan")
    third = _cli(memo, out, "--force")
    assert third.returncode == 1
    assert json.loads(manifest.read_text()) == {}
    assert not (out / "tone" / "99.wav").exists()


def test_cli_needs_memo_and_out_dir():
    assert _cli("only-one").returncode == 2


def test_cli_success_message_and_exit_zero(tmp_path, monkeypatch, capsys):
    memo = tmp_path / "ok.m4a"
    memo.write_bytes(b"")
    monkeypatch.setattr(prepare_mod, "load_16k_mono", lambda p: np.full(16000 * 100, 0.1, np.float32))
    probs = ([0.9] * 34 + [0.1] * 34) * 30
    monkeypatch.setattr(prepare_mod, "vad_probs", lambda audio, rate: (probs, 30))
    assert prepare_mod.main([str(memo), str(tmp_path / "clips")]) == 0
    assert "ok: 30 utterances, labelled" in capsys.readouterr().out
