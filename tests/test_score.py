from bench.score import (
    MAX_STT_P50_S,
    MAX_WER,
    MIN_COMMAND_RATE,
    ClipResult,
    command_hit,
    normalise,
    summarise,
    wer,
)


def rows_with(wer: float, cmd_rate: float, p50: float) -> list[ClipResult]:
    """Synthetic rows whose aggregates hit the given values exactly.

    10 ordinary rows of 10 reference words each (100 words), so the corpus
    WER is subs / 100. 20 command rows, so the command rate is hits / 20.
    Every clip decodes in exactly p50 seconds.
    """
    ref_words = [f"w{j}" for j in range(10)]
    subs = round(wer * 100)
    sub_at = [0] * 10  # substitutions per ordinary row
    for k in range(subs):
        sub_at[k % 10] += 1
    rows: list[ClipResult] = []
    line_id = 1
    for i in range(10):
        ref = " ".join(ref_words)
        hyp_words = ref_words.copy()
        for j in range(sub_at[i]):
            hyp_words[j] = "x"
        rows.append(ClipResult(line_id, "ordinary", ref, " ".join(hyp_words), p50))
        line_id += 1
    misses = round((1 - cmd_rate) * 20)
    for i in range(20):
        hyp = "" if i < misses else "stop"
        rows.append(ClipResult(line_id, "command", "stop", hyp, p50))
        line_id += 1
    return rows


def test_normalise(): assert normalise("Session.ts, OK?") == "session ts ok"
def test_wer_empty_hyp_is_one(): assert wer("stop the job", "") == 1.0
def test_wer_hallucination_counts(): assert wer("stop", "thank you for watching") >= 1.0
def test_command_hit_whole_word():
    assert command_hit("stop", "okay stop.")
    assert not command_hit("stop", "unstoppable")
def test_passes_uses_spec_bars():
    s = summarise(rows_with(wer=0.10, cmd_rate=0.95, p50=1.1))
    assert s.passes
    s = summarise(rows_with(wer=0.11, cmd_rate=0.95, p50=1.1))
    assert not s.passes and "WER" in s.reasons[0]


def test_bar_constants():
    assert MAX_WER == 0.10
    assert MIN_COMMAND_RATE == 0.95
    assert MAX_STT_P50_S == 1.1


def test_wer_empty_reference_rule():
    assert wer("", "") == 0.0
    assert wer("", "hello") == 1.0


def test_command_hit_rejects_empty_reference():
    assert not command_hit("", "anything")


def test_summarise_wer_is_corpus_level():
    rows = [
        ClipResult(1, "ordinary", "a b c d", "a b c d", 0.5),  # 0 edits / 4 words
        ClipResult(2, "ordinary", "e f", "x", 0.5),            # 2 edits / 2 words
        ClipResult(3, "command", "stop", "stop", 0.5),
    ]
    s = summarise(rows)
    assert abs(s.wer_ordinary - 2 / 6) < 1e-9


def test_summarise_command_rate_and_latency_percentiles():
    rows = [ClipResult(i, "command", "stop", "stop", float(i)) for i in range(1, 6)]
    s = summarise(rows)
    assert s.command_rate == 1.0
    assert s.decode_p50 == 3.0
    assert s.decode_p95 == 4.8  # numpy linear interpolation over 1..5


def test_summarise_no_command_rows_fails_with_reason():
    rows = [ClipResult(1, "ordinary", "a b", "a b", 0.5)]
    s = summarise(rows)
    assert s.command_rate == 0.0
    assert not s.passes
    assert any("no command clips" in r for r in s.reasons)


def test_summarise_no_ordinary_rows_gives_zero_wer():
    rows = [ClipResult(1, "command", "stop", "stop", 0.5)]
    s = summarise(rows)
    assert s.wer_ordinary == 0.0


def test_reasons_in_order_wer_commands_latency():
    s = summarise(rows_with(wer=0.20, cmd_rate=0.50, p50=2.0))
    assert not s.passes
    assert len(s.reasons) == 3
    assert "WER" in s.reasons[0]
    assert "command" in s.reasons[1].lower()
    assert "p50" in s.reasons[2] or "latency" in s.reasons[2].lower()


def test_passes_false_when_only_latency_fails():
    s = summarise(rows_with(wer=0.0, cmd_rate=1.0, p50=1.2))
    assert not s.passes
    assert len(s.reasons) == 1
