"""Score speech engine output against the reading card and the spec bars."""

import re
from dataclasses import dataclass

import jiwer
import numpy as np

MAX_WER = 0.10
MIN_COMMAND_RATE = 0.95
MAX_STT_P50_S = 1.1


@dataclass(frozen=True)
class ClipResult:
    line_id: int
    kind: str
    ref: str
    hyp: str
    decode_s: float


@dataclass(frozen=True)
class EngineScore:
    wer_ordinary: float
    command_rate: float
    decode_p50: float
    decode_p95: float
    passes: bool
    reasons: list[str]


_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalise(s: str) -> str:
    return _NON_ALNUM.sub(" ", s.lower()).strip()


def wer(ref: str, hyp: str) -> float:
    r, h = normalise(ref), normalise(hyp)
    if not r:
        return 0.0 if not h else 1.0
    return float(jiwer.wer(r, h))


def command_hit(ref: str, hyp: str) -> bool:
    r, h = normalise(ref), normalise(hyp)
    if not r:
        return False
    return f" {r} " in f" {h} "


def _corpus_wer(rows: list[ClipResult]) -> float:
    if not rows:
        return 0.0
    refs = [normalise(row.ref) for row in rows]
    hyps = [normalise(row.hyp) for row in rows]
    if not any(refs):
        return 0.0 if not any(hyps) else 1.0
    return float(jiwer.wer(refs, hyps))


def summarise(rows: list[ClipResult]) -> EngineScore:
    ordinary = [row for row in rows if row.kind == "ordinary"]
    commands = [row for row in rows if row.kind == "command"]

    wer_ordinary = _corpus_wer(ordinary)

    if commands:
        command_rate = sum(command_hit(row.ref, row.hyp) for row in commands) / len(commands)
    else:
        command_rate = 0.0

    if rows:
        latencies = np.array([row.decode_s for row in rows], dtype=float)
        decode_p50 = float(np.percentile(latencies, 50))
        decode_p95 = float(np.percentile(latencies, 95))
    else:
        decode_p50 = decode_p95 = 0.0

    reasons: list[str] = []
    if wer_ordinary > MAX_WER:
        reasons.append(f"WER {wer_ordinary:.3f} above the {MAX_WER:.2f} bar")
    if not commands:
        reasons.append("no command clips in the run")
    elif command_rate < MIN_COMMAND_RATE:
        reasons.append(
            f"command rate {command_rate:.3f} below the {MIN_COMMAND_RATE:.2f} bar"
        )
    if decode_p50 > MAX_STT_P50_S:
        reasons.append(f"STT p50 {decode_p50:.2f}s above the {MAX_STT_P50_S}s bar")

    return EngineScore(
        wer_ordinary=wer_ordinary,
        command_rate=command_rate,
        decode_p50=decode_p50,
        decode_p95=decode_p95,
        passes=not reasons,
        reasons=reasons,
    )
