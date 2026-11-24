"""Speech worker: STT and TTS over JSON lines (stdin requests, stdout replies).

Only protocol lines go to stdout; logging goes to stderr.
"""

import argparse
import base64
import json
import sys

import numpy as np

from bench import stt as stt_mod
from bench import tts as tts_mod


def _log(msg: str) -> None:
    print(f"[worker] {msg}", file=sys.stderr, flush=True)


def _emit(out, obj: dict) -> None:
    out.write(json.dumps(obj) + "\n")
    out.flush()


def _handle(req: dict, stt, tts) -> dict:
    op = req.get("op")
    if op == "stt":
        raw = np.frombuffer(base64.b64decode(req["pcm16k"]), dtype="<i2")
        audio = raw.astype(np.float32) / 32768.0
        return {"text": stt.transcribe(audio, stt_mod.VOCAB_PROMPT)}
    if op == "tts":
        samples, rate = tts.synth(req["text"])
        pcm = np.clip(np.asarray(samples, dtype=np.float32) * 32767.0, -32768, 32767).astype("<i2")
        return {"pcm": base64.b64encode(pcm.tobytes()).decode(), "rate": int(rate)}
    raise ValueError(f"unknown op {op!r}")


def main(argv=None, stdin=None, stdout=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stt", required=True)
    ap.add_argument("--tts", required=True)
    args = ap.parse_args(argv)
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout

    stt = stt_mod.ENGINES[args.stt]()
    tts = tts_mod.TTS_ENGINES[args.tts]()
    stt.load()
    tts.load()
    stt.transcribe(np.zeros(8000, dtype=np.float32), stt_mod.VOCAB_PROMPT)  # warm-up
    tts.synth(tts_mod.WARMUP_SENTENCE)
    _emit(stdout, {"ready": True, "stt": args.stt, "tts": args.tts})

    for line in stdin:
        if not line.strip():
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            reply = {"id": rid, **_handle(req, stt, tts)}
        except Exception as exc:  # keep serving
            _log(f"error: {exc!r}")
            reply = {"id": rid, "error": f"{type(exc).__name__}: {exc}"}
        _emit(stdout, reply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
