"""Bench runner: one engine per process, results as JSON.

    python -m bench.run stt --clips clips/ --engine <name> --out results/<host>/<engine>.json
    python -m bench.run tts --engine <name> --out results/<host>/<engine>.json
"""

import argparse
import json
import resource
import shutil
import socket
import subprocess
import threading
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np

from bench.card import LINES
from bench.prepare import LabelledClip, load_clips
from bench.score import ClipResult, summarise
from bench.stt import ENGINES, VOCAB_PROMPT, SttEngine
from bench.tts import MAX_TTS_FIRST_AUDIO_P50_S, MEASUREMENT, TTS_ENGINES


def run_stt(engine: SttEngine, clips: list[LabelledClip]) -> list[ClipResult]:
    """One untimed warm-up decode on the first clip, then time each labelled clip."""
    by_id = {line.id: line for line in LINES}
    labelled = [c for c in clips if c.line_id is not None]
    if not labelled:
        return []
    engine.transcribe(labelled[0].audio, VOCAB_PROMPT)  # warm-up, never timed
    rows = []
    for clip in labelled:
        line = by_id[clip.line_id]
        start = time.perf_counter()
        hyp = engine.transcribe(clip.audio, VOCAB_PROMPT)
        rows.append(ClipResult(line.id, line.kind, line.text, hyp, time.perf_counter() - start))
    return rows


class VramPoller:
    """Peak GPU memory (MB) above the reading taken at construction; None without nvidia-smi."""

    def __init__(self, interval: float = 0.5):
        self.interval = interval
        self.enabled = shutil.which("nvidia-smi") is not None
        self.peak: float | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._baseline = self._read() if self.enabled else None
        if self._baseline is None:
            self.enabled = False

    @staticmethod
    def _read() -> float | None:
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5, check=True).stdout
            return float(out.strip().splitlines()[0])
        except Exception:
            return None

    def _loop(self) -> None:
        while not self._stop.is_set():
            value = self._read()
            if value is not None:
                self.peak = value if self.peak is None else max(self.peak, value)
            self._stop.wait(self.interval)

    def __enter__(self):
        if self.enabled:
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()
        return self

    def __exit__(self, *exc):
        if self._thread:
            self._stop.set()
            self._thread.join()
            value = self._read()  # final reading, in case the run was shorter than one interval
            if value is not None:
                self.peak = value if self.peak is None else max(self.peak, value)

    def peak_so_far(self) -> float | None:
        """Peak above the baseline so far (also valid mid-run, e.g. after a failure)."""
        if not self.enabled:
            return None
        value = self._read()
        if value is not None:
            self.peak = value if self.peak is None else max(self.peak, value)
        if self.peak is None:
            return None
        return max(0.0, self.peak - self._baseline)


def _failure(exc: BaseException) -> str:
    from bench.stt import ModelMissing

    if isinstance(exc, ModelMissing):
        return f"failed: ModelMissing: {exc.path}"
    return f"failed: {type(exc).__name__}: {exc}"


def _peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # Linux reports KiB


def _write(out: Path, data: dict) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2) + "\n")
    return out


def run_stt_cli(engine: str, clips: Path, out: Path, host: str | None = None) -> Path:
    host = host or socket.gethostname()
    data: dict = {"kind": "stt", "engine": engine, "host": host, "device": None,
                  "status": "ok", "rows": []}
    try:
        all_clips = load_clips(clips)
        data["skipped_unlabelled"] = sum(c.line_id is None for c in all_clips)
        with VramPoller() as vram:
            try:
                eng = ENGINES[engine]()
                eng.load()
                data["device"] = getattr(eng, "device", None)
                rows = run_stt(eng, all_clips)
            finally:
                data["peak_vram_mb"] = vram.peak_so_far()
        score = summarise(rows)
        data["rows"] = [asdict(r) for r in rows]
        data.update(asdict(score))
    except Exception as exc:
        data["status"] = _failure(exc)
    data["peak_rss_mb"] = _peak_rss_mb()
    data.setdefault("peak_vram_mb", None)
    data.setdefault("skipped_unlabelled", 0)
    return _write(out, data)


def run_tts_cli(engine: str, out: Path, host: str | None = None) -> Path:
    host = host or socket.gethostname()
    data: dict = {"kind": "tts", "engine": engine, "host": host, "status": "ok",
                  "measurement": MEASUREMENT, "sentences": []}
    try:
        eng = TTS_ENGINES[engine]()
        eng.load()
        sentences = [line.text for line in LINES if line.kind == "ordinary"]
        times = [eng.first_audio_s(s) for s in sentences]
        data["sentences"] = [{"text": s, "first_audio_s": t} for s, t in zip(sentences, times)]
        data["first_audio_p50"] = float(np.percentile(times, 50))
        data["first_audio_p95"] = float(np.percentile(times, 95))
        data["bar_p50_s"] = MAX_TTS_FIRST_AUDIO_P50_S
        data["passes"] = data["first_audio_p50"] <= MAX_TTS_FIRST_AUDIO_P50_S
    except Exception as exc:
        data["status"] = _failure(exc)
    data["peak_rss_mb"] = _peak_rss_mb()
    return _write(out, data)


def guarded(kind: str, engine: str, host: str, out: Path, cmd: list[str]) -> int:
    """Run one engine's process; a crash (OOM kill, abort) still leaves a failed result.

    Any earlier result is deleted first, so a stale JSON can never pass for a fresh one.
    """
    out.unlink(missing_ok=True)
    code = subprocess.run(cmd).returncode
    if code != 0 and not out.exists():
        _write(out, {"kind": kind, "engine": engine, "host": host, "status": f"failed: exited {code}"})
    return code


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="bench.run")
    sub = p.add_subparsers(dest="mode", required=True)
    s = sub.add_parser("stt")
    s.add_argument("--clips", type=Path, default=Path("clips"))
    s.add_argument("--engine", required=True, choices=sorted(ENGINES))
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--host")
    t = sub.add_parser("tts")
    t.add_argument("--engine", required=True, choices=sorted(TTS_ENGINES))
    t.add_argument("--out", type=Path, required=True)
    t.add_argument("--host")
    g = sub.add_parser("guard", help="run an engine command; record a failed result if it crashes")
    g.add_argument("--kind", required=True, choices=["stt", "tts"])
    g.add_argument("--engine", required=True)
    g.add_argument("--host", required=True)
    g.add_argument("--out", type=Path, required=True)
    g.add_argument("cmd", nargs=argparse.REMAINDER)
    a = p.parse_args(argv)
    if a.mode == "guard":
        cmd = a.cmd[1:] if a.cmd[:1] == ["--"] else a.cmd
        guarded(a.kind, a.engine, a.host, a.out, cmd)
        return
    if a.mode == "stt":
        out = run_stt_cli(a.engine, a.clips, a.out, a.host)
    else:
        out = run_tts_cli(a.engine, a.out, a.host)
    print(f"wrote {out}: {json.loads(out.read_text())['status']}")


if __name__ == "__main__":
    main()
