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
