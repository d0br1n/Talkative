"""Turn a voice memo into one labelled WAV clip per card line."""

import argparse
import json
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from bench.audio import SAMPLE_RATE, load_16k_mono
from bench.card import LINES
from bench.segment import segments_from_probs

VAD_MODEL = Path(__file__).resolve().parent.parent / "models" / "silero_vad.onnx"
VAD_WINDOW = 512  # samples per Silero frame at 16 kHz (32 ms)
PAD_MS = 100  # context kept around each utterance when cutting clips


@dataclass(frozen=True)
class PrepareResult:
    labelled: bool
    count: int
    clips: list[Path]


@dataclass(frozen=True)
class LabelledClip:
    memo: str
    path: Path
    line_id: int | None
    audio: np.ndarray


def vad_probs(audio: np.ndarray, sample_rate: int) -> tuple[list[float], int]:
    """Per-frame speech probabilities from the Silero VAD ONNX model, and the frame length in ms.

    sherpa-onnx's Python VadModel only exposes a boolean `is_speech`, so the model is run
    directly with onnxruntime to get real probabilities.
    """
    import onnxruntime as ort

    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"Silero VAD expects {SAMPLE_RATE} Hz, got {sample_rate}")
    if not VAD_MODEL.exists():
        raise FileNotFoundError(f"{VAD_MODEL} missing; run scripts/fetch_models.sh")
    session = ort.InferenceSession(str(VAD_MODEL), providers=["CPUExecutionProvider"])
    h = np.zeros((2, 1, 64), dtype=np.float32)
    c = np.zeros((2, 1, 64), dtype=np.float32)
    probs: list[float] = []
    for i in range(0, len(audio) - VAD_WINDOW + 1, VAD_WINDOW):
        x = audio[i : i + VAD_WINDOW].astype(np.float32)[None, :]
        prob, h, c = session.run(None, {"x": x, "h": h, "c": c})
        probs.append(float(prob[0, 0]))
    return probs, VAD_WINDOW * 1000 // sample_rate


def prepare(memo: Path, out_dir: Path) -> PrepareResult:
    """Split `memo` into clips under `out_dir/<memo-stem>/`, labelled 1..30 if exactly 30 found."""
    audio = load_16k_mono(memo)
    probs, frame_ms = vad_probs(audio, SAMPLE_RATE)
    segments = segments_from_probs(probs, frame_ms)
    expected = len(LINES)
    labelled = len(segments) == expected
    if not labelled:
        print(
            f"{memo.stem}: found {len(segments)} utterances, expected {expected}"
            " — clips written unlabelled; edit manifest.json"
        )

    folder = out_dir / memo.stem
    if folder.exists():
        shutil.rmtree(folder)  # clear orphan clips from an earlier run (the CLI guards overwrites)
    folder.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, int | None] = {}
    clips: list[Path] = []
    for n, (start_ms, end_ms) in enumerate(segments, start=1):
        a = max(0, (start_ms - PAD_MS) * SAMPLE_RATE // 1000)
        b = min(len(audio), (end_ms + PAD_MS) * SAMPLE_RATE // 1000)
        path = folder / f"{n:02d}.wav"
        sf.write(path, audio[a:b], SAMPLE_RATE, subtype="PCM_16")
        clips.append(path)
        manifest[path.name] = LINES[n - 1].id if labelled else None
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return PrepareResult(labelled=labelled, count=len(segments), clips=clips)


def load_clips(clips_dir: Path) -> list[LabelledClip]:
    """Read every memo folder under `clips_dir` into LabelledClips."""
    result: list[LabelledClip] = []
    for manifest_path in sorted(clips_dir.glob("*/manifest.json")):
        manifest: dict[str, int | None] = json.loads(manifest_path.read_text())
        for name, line_id in sorted(manifest.items()):
            valid = line_id is None or (
                isinstance(line_id, int) and not isinstance(line_id, bool) and 1 <= line_id <= len(LINES)
            )
            if not valid:
                raise ValueError(
                    f"{manifest_path}: bad id {line_id!r} for {name}; use an integer 1..{len(LINES)} or null"
                )
            path = manifest_path.parent / name
            audio, _ = sf.read(path, dtype="float32")
            result.append(LabelledClip(manifest_path.parent.name, path, line_id, audio))
    return result


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="bench.prepare",
        description="Split voice memos into labelled 16 kHz clips: MEMO [MEMO ...] OUT_DIR",
    )
    p.add_argument("paths", nargs="+", type=Path, metavar="PATH",
                   help="one or more memo files, then the output directory")
    p.add_argument("--force", action="store_true",
                   help="overwrite memos already prepared (discards manual manifest edits)")
    a = p.parse_args(argv)
    if len(a.paths) < 2:
        p.error("need at least one MEMO and an OUT_DIR")
    *memos, out_dir = a.paths

    existing = [m for m in memos if (out_dir / m.stem / "manifest.json").exists()]
    if existing and not a.force:
        for m in existing:
            print(f"{m.stem}: {out_dir / m.stem / 'manifest.json'} already exists; "
                  "pass --force to overwrite (this discards manual manifest edits)")
        return 2

    failures = 0
    for memo in memos:
        result = prepare(memo, out_dir)
        if result.labelled:
            print(f"{memo.stem}: {result.count} utterances, labelled")
        else:
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
