"""Split a recording into utterances from per-frame speech probabilities."""

from collections.abc import Sequence


def segments_from_probs(
    probs: Sequence[float],
    frame_ms: int,
    threshold: float = 0.5,
    min_silence_ms: int = 800,
    min_speech_ms: int = 300,
) -> list[tuple[int, int]]:
    """Return (start_ms, end_ms) utterances.

    A run of at least `min_silence_ms` of non-speech frames ends an utterance; shorter
    gaps are bridged. Utterances shorter than `min_speech_ms` are dropped as noise.
    The end is the end of the last speech frame.
    """
    segments: list[tuple[int, int]] = []
    start: int | None = None  # frame index of first speech frame
    last: int | None = None  # frame index of last speech frame

    def close() -> None:
        if start is not None and last is not None:
            s, e = start * frame_ms, (last + 1) * frame_ms
            if e - s >= min_speech_ms:
                segments.append((s, e))

    for i, p in enumerate(probs):
        if p >= threshold:
            if start is None:
                start = i
            last = i
        elif start is not None and last is not None and (i - last) * frame_ms >= min_silence_ms:
            close()
            start = last = None
    close()
    return segments
