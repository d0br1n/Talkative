import json

import pytest

from bench import run
from bench.report import report
from bench.run import run_stt, run_stt_cli


def test_warmup_not_timed(fake_engine, clips):
    rows = run_stt(fake_engine, clips)
    assert max(r.decode_s for r in rows) < 0.5
    assert len(rows) == 3  # the unlabelled clip is skipped


def test_failed_engine_recorded(tmp_path, clips, monkeypatch):
    class Boom:
        name = "boom"
        device = "cpu"

        def load(self):
            raise MemoryError("no ram")

    monkeypatch.setitem(run.ENGINES, "boom", Boom)
    monkeypatch.setattr(run, "load_clips", lambda p: clips)
    out = run_stt_cli(engine="boom", clips=tmp_path, out=tmp_path / "r" / "boom.json")
    data = json.loads(out.read_text())
    assert data["status"].startswith("failed: MemoryError")


def test_model_missing_recorded(tmp_path, clips, monkeypatch):
    from bench.stt import ModelMissing

    class Missing:
        name = "m"
        device = "cpu"

        def load(self):
            raise ModelMissing("/x/y")

    monkeypatch.setitem(run.ENGINES, "m", Missing)
    monkeypatch.setattr(run, "load_clips", lambda p: clips)
    out = run_stt_cli(engine="m", clips=tmp_path, out=tmp_path / "m.json")
    assert json.loads(out.read_text())["status"] == "failed: ModelMissing: /x/y"


def test_stt_cli_success_fields(tmp_path, fake_engine, clips, monkeypatch):
    monkeypatch.setitem(run.ENGINES, "fake", lambda: fake_engine)
    monkeypatch.setattr(run, "load_clips", lambda p: clips)
    out = run_stt_cli(engine="fake", clips=tmp_path, out=tmp_path / "fake.json", host="lap")
    data = json.loads(out.read_text())
    assert data["status"] == "ok" and data["host"] == "lap" and data["device"] == "cpu"
    assert data["skipped_unlabelled"] == 1 and len(data["rows"]) == 3
    assert data["peak_rss_mb"] > 0 and "peak_vram_mb" in data


def test_report_marks_bars(results_dir_with_one_passing_one_failing):
    md = report(results_dir_with_one_passing_one_failing)
    assert "✅" in md and "❌" in md and "WER" in md
    assert "failed: MemoryError: oom" in md
    assert "kokoro" in md


def test_crash_leaves_failed_record_and_report_entry(tmp_path):
    import sys

    from bench.run import guarded

    out = tmp_path / "boom.json"
    out.write_text(json.dumps({"engine": "boom", "kind": "stt", "status": "ok", "passes": True}))  # stale
    code = guarded("stt", "boom", "h", out, [sys.executable, "-c", "import os; os._exit(137)"])
    assert code == 137
    assert json.loads(out.read_text())["status"] == "failed: exited 137"
    md = report(tmp_path)
    assert "boom" in md and "failed: exited 137" in md


def test_guard_keeps_fresh_result(tmp_path):
    import sys

    from bench.run import guarded

    out = tmp_path / "e.json"
    script = f"import pathlib; pathlib.Path({str(out)!r}).write_text('{{\"status\": \"failed: X: y\"}}')"
    guarded("stt", "e", "h", out, [sys.executable, "-c", script + "; raise SystemExit(1)"])
    assert json.loads(out.read_text())["status"] == "failed: X: y"


def test_guard_cli_via_script_path(tmp_path):
    import subprocess
    import sys

    out = tmp_path / "x.json"
    subprocess.run([sys.executable, "-m", "bench.run", "guard", "--kind", "tts", "--engine", "x",
                    "--host", "h", "--out", str(out), "--", sys.executable, "-c", "raise SystemExit(3)"],
                   check=True)
    assert json.loads(out.read_text()) == {"kind": "tts", "engine": "x", "host": "h",
                                          "status": "failed: exited 3"}


def test_tts_json_has_measurement_and_report_note(tmp_path, monkeypatch):
    class FakeTts:
        name = "ft"

        def load(self):
            pass

        def first_audio_s(self, s):
            return 0.1

    monkeypatch.setitem(run.TTS_ENGINES, "ft", FakeTts)
    out = run.run_tts_cli("ft", tmp_path / "ft.json", host="h")
    data = json.loads(out.read_text())
    assert "non-streaming" in data["measurement"] and len(data["sentences"]) == 19
    assert "non-streaming" in report(tmp_path)


def test_failed_stt_keeps_vram_peak(tmp_path, clips, monkeypatch):
    class Boom:
        name = "b"
        device = "cuda"

        def load(self):
            raise MemoryError("oom")

    monkeypatch.setitem(run.ENGINES, "b", Boom)
    monkeypatch.setattr(run, "load_clips", lambda p: clips)
    monkeypatch.setattr(run.VramPoller, "peak_so_far", lambda self: 1234.0)
    data = json.loads(run_stt_cli("b", tmp_path, tmp_path / "b.json").read_text())
    assert data["status"].startswith("failed: MemoryError") and data["peak_vram_mb"] == 1234.0
