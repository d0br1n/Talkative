import base64
import io
import json

import numpy as np

from bench import tts as tts_mod
from bench import worker
from bench import stt as stt_mod


class FakeStt:
    name = "fake-stt"
    device = "cpu"
    seen: list = []

    def load(self):
        pass

    def transcribe(self, audio, prompt):
        FakeStt.seen.append((audio, prompt))
        if len(audio) == 3:
            raise ValueError("boom")
        return f"n={len(audio)}"


class FakeTts:
    name = "fake-tts"

    def load(self):
        pass

    def synth(self, text):
        return np.array([0.0, 0.5, -0.5, 1.0], dtype=np.float32), 22050


def run(monkeypatch, requests):
    monkeypatch.setitem(stt_mod.ENGINES, "f", FakeStt)
    monkeypatch.setitem(tts_mod.TTS_ENGINES, "f", FakeTts)
    stdin = io.StringIO("".join(json.dumps(r) + "\n" for r in requests))
    stdout = io.StringIO()
    worker.main(["--stt", "f", "--tts", "f"], stdin=stdin, stdout=stdout)
    return [json.loads(line) for line in stdout.getvalue().splitlines()]


def b64(samples):
    return base64.b64encode(np.array(samples, dtype="<i2").tobytes()).decode()


def test_ready_line_first(monkeypatch):
    out = run(monkeypatch, [])
    assert out == [{"ready": True, "stt": "f", "tts": "f"}]


def test_stt_round_trip_converts_to_float(monkeypatch):
    FakeStt.seen = []
    out = run(monkeypatch, [{"id": 1, "op": "stt", "pcm16k": b64([0, 16384, -32768, 1, 2])}])
    assert out[1] == {"id": 1, "text": "n=5"}
    audio, prompt = FakeStt.seen[-1]
    assert audio.dtype == np.float32
    assert audio[1] == 0.5 and audio[2] == -1.0
    assert prompt == stt_mod.VOCAB_PROMPT


def test_tts_round_trip(monkeypatch):
    out = run(monkeypatch, [{"id": 2, "op": "tts", "text": "hi"}])
    assert out[1]["id"] == 2 and out[1]["rate"] == 22050
    pcm = np.frombuffer(base64.b64decode(out[1]["pcm"]), dtype="<i2")
    assert pcm.tolist() == [0, 16383, -16383, 32767]


def test_error_keeps_worker_alive(monkeypatch):
    out = run(monkeypatch, [
        {"id": 1, "op": "stt", "pcm16k": b64([1, 2, 3])},
        {"id": 2, "op": "nope"},
        {"id": 3, "op": "stt", "pcm16k": b64([1, 2])},
    ])
    assert out[1] == {"id": 1, "error": "ValueError: boom"}
    assert out[2]["id"] == 2 and out[2]["error"].startswith("ValueError")
    assert out[3] == {"id": 3, "text": "n=2"}


def _run_subprocess(code: str, stdin: str = ""):
    import subprocess
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    return subprocess.run([sys.executable, "-c", code], input=stdin, capture_output=True, text=True,
                          cwd=root, timeout=60)


def test_native_stdout_noise_does_not_corrupt_replies():
    code = '''
import os
from bench import stt as s, tts as t, worker

class E:
    name = device = "x"
    def load(self): pass
    def transcribe(self, audio, prompt):
        os.write(1, b"noise")
        print("python noise")
        return "ok"
class T(E):
    def synth(self, text): return None, 0
s.ENGINES["f"] = E
t.TTS_ENGINES["f"] = T
E.synth = lambda self, text: (__import__("numpy").zeros(2, dtype="float32"), 8000)
worker.main(["--stt", "f", "--tts", "f"])
'''
    import json as _json
    req = _json.dumps({"id": 1, "op": "stt", "pcm16k": b64([1, 2])}) + "\n"
    res = _run_subprocess(code, req)
    lines = res.stdout.splitlines()
    assert [_json.loads(x) for x in lines] == [
        {"ready": True, "stt": "f", "tts": "f"}, {"id": 1, "text": "ok"}]
    assert "noise" in res.stderr


def test_starting_marker_is_first_stderr_line():
    res = _run_subprocess("import sys; sys.argv=['w','--stt','nope','--tts','nope']; "
                          "from bench import worker; worker.main()")
    assert res.stderr.splitlines()[0] == "worker: starting"
