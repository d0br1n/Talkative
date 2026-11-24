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


def test_rows_carry_memo_and_quiet_is_not_scored(tmp_path, monkeypatch):
    import numpy as np
    from pathlib import Path

    from bench.prepare import LabelledClip

    class Echo:
        name = "echo"
        device = "cpu"

        def load(self):
            pass

        def transcribe(self, audio, prompt):
            return "stop"

    a = np.zeros(1600, dtype=np.float32)
    clips = [LabelledClip("gym-1", Path("a.wav"), 3, a), LabelledClip("quiet-1", Path("b.wav"), 1, a),
             LabelledClip("transit-1", Path("c.wav"), 3, a)]
    monkeypatch.setitem(run.ENGINES, "echo", Echo)
    monkeypatch.setattr(run, "load_clips", lambda p: clips)
    data = json.loads(run_stt_cli("echo", tmp_path, tmp_path / "e.json").read_text())
    assert [r["memo"] for r in data["rows"]] == ["gym-1", "quiet-1", "transit-1"]
    # the quiet clip (line 1, "continue") is a miss, but only gym/transit decide the verdict
    assert data["command_hits"] == {"stop": [2, 2]}


def test_no_labelled_clips_is_failed(tmp_path, monkeypatch):
    import numpy as np
    from pathlib import Path

    from bench.prepare import LabelledClip

    monkeypatch.setitem(run.ENGINES, "boom", lambda: (_ for _ in ()).throw(AssertionError("loaded")))
    monkeypatch.setattr(run, "load_clips",
                        lambda p: [LabelledClip("m", Path("x.wav"), None, np.zeros(10, np.float32))])
    data = json.loads(run_stt_cli("boom", tmp_path / "clips", tmp_path / "o.json").read_text())
    assert data["status"] == f"failed: no labelled clips under {tmp_path / 'clips'}"
    monkeypatch.setattr(run, "load_clips", lambda p: [])
    data = json.loads(run_stt_cli("boom", tmp_path / "clips", tmp_path / "o.json").read_text())
    assert data["status"].startswith("failed: no labelled clips")


def test_run_stt_raises_without_labelled_clips(fake_engine):
    with pytest.raises(run.NoLabelledClips):
        run_stt(fake_engine, [])


def test_run_all_refuses_stt_without_clips(tmp_path):
    import shutil
    import subprocess
    from pathlib import Path

    repo = Path(__file__).resolve().parent.parent
    work = tmp_path / "repo"
    (work / "scripts").mkdir(parents=True)
    shutil.copy(repo / "scripts" / "run_all.sh", work / "scripts" / "run_all.sh")
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    uv = fake_bin / "uv"
    uv.write_text("#!/bin/sh\necho \"$@\" >> \"$(dirname \"$0\")/calls\"\n"
                  "case \"$*\" in *ENGINES*) echo whisper-x;; *TTS_ENGINES*) echo kokoro;; esac\n")
    uv.chmod(0o755)
    env = {"PATH": f"{fake_bin}:/usr/bin:/bin"}
    proc = subprocess.run(["bash", str(work / "scripts" / "run_all.sh"), "h"], capture_output=True,
                          text=True, env=env)
    calls = (fake_bin / "calls").read_text()
    assert "No clips/*/manifest.json" in proc.stderr
    assert "bench.run stt" not in calls and "bench.run tts" in calls


def test_tts_json_device_and_report_note(tmp_path, monkeypatch):
    class FakeTts:
        name = "ft"

        def load(self):
            pass

        def first_audio_s(self, s):
            return 0.1

    monkeypatch.setitem(run.TTS_ENGINES, "ft", FakeTts)
    data = json.loads(run.run_tts_cli("ft", tmp_path / "ft.json", host="h").read_text())
    assert data["device"] == "cpu"
    md = report(tmp_path)
    assert "| Device |" in md and "| ft | cpu |" in md
    assert "TTS on GPU was not measured" in md


def test_report_per_memo_commands_and_estimate(tmp_path):
    def row(memo, line_id, kind, ref, hyp):
        return {"line_id": line_id, "kind": kind, "ref": ref, "hyp": hyp, "decode_s": 0.3, "memo": memo}

    rows = [row("gym-1", 3, "command", "stop", "stop"), row("gym-1", 2, "ordinary", "a b", "a b"),
            row("quiet-1", 3, "command", "stop", "")]
    (tmp_path / "e.json").write_text(json.dumps({
        "engine": "eng", "kind": "stt", "device": "cpu", "host": "h", "status": "ok", "rows": rows,
        "wer_ordinary": 0.0, "command_rate": 1.0, "decode_p50": 1.5, "decode_p95": 2.0,
        "passes": True, "reasons": [], "command_hits": {"stop": [1, 1]},
        "peak_rss_mb": 1.0, "peak_vram_mb": None, "skipped_unlabelled": 0}))
    (tmp_path / "t.json").write_text(json.dumps({
        "engine": "kokoro", "kind": "tts", "device": "cpu", "host": "h", "status": "ok",
        "sentences": [], "first_audio_p50": 0.4, "first_audio_p95": 0.5, "passes": True}))
    md = report(tmp_path)
    assert "quiet-1 (control)" in md and "gym-1" in md
    assert "n=2, WER 0.000, cmd 1.00" in md and "n=1, WER n/a, cmd 0.00" in md
    assert "| eng | 1/1 |" in md  # per-command hits (only "stop" seen)
    assert "excluded from pass/fail" in md
    # 1.5 + max(0, 1.5 - 1.1) + 1.6 + 0.4 + 0.2 = 4.10 -> over the 4.0 target
    assert "| eng | kokoro | 4.10 | ❌ |" in md and "Estimate only" in md
