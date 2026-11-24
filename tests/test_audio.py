import shutil
import subprocess

import numpy as np
import pytest

from bench.audio import load_16k_mono


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_load_m4a_stereo_48k(tmp_path):
    m4a = tmp_path / "memo.m4a"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=48000",
         "-ac", "2", "-c:a", "aac", str(m4a)],
        check=True,
    )
    audio = load_16k_mono(m4a)
    assert audio.dtype == np.float32 and audio.ndim == 1
    assert abs(len(audio) - 16000) < 400
