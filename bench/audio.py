"""Audio loading: decode any memo format to 16 kHz mono float32 via ffmpeg."""

import subprocess
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000


def load_16k_mono(path: Path) -> np.ndarray:
    """Decode `path` (m4a, wav, ...) to a float32 mono array at 16 kHz."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(path),
        "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed on {path}: {proc.stderr.decode(errors='replace').strip()}")
    return np.frombuffer(proc.stdout, dtype="<f4").astype(np.float32)
