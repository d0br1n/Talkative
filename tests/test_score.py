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


def _cmd_rows(hits_by_command: dict[str, tuple[int, int]]) -> list[ClipResult]:
    rows = [ClipResult(1, "ordinary", "a b", "a b", 0.1)]
    for cmd, (hits, total) in hits_by_command.items():
        for i in range(total):
            rows.append(ClipResult(2, "command", cmd, cmd if i < hits else "", 0.1))
    return rows


def test_per_command_hits_reported():
    s = summarise(_cmd_rows({"continue": (10, 10), "stop": (9, 10)}))
    assert s.command_hits == {"continue": [10, 10], "stop": [9, 10]}
    assert abs(s.command_rate - 19 / 20) < 1e-9


def test_one_weak_command_fails_even_if_pooled_rate_passes():
    rows = _cmd_rows({"continue": (50, 50), "audio on": (4, 5)})  # pooled 54/55 = 0.98
    s = summarise(rows)
    assert s.command_rate >= 0.95
    assert not s.passes
    assert any("audio on 4/5" in r for r in s.reasons)


def test_all_commands_at_bar_passes():
    s = summarise(_cmd_rows({"continue": (19, 20), "stop": (19, 20)}))
    assert s.passes and s.reasons == []


def test_memo_field_defaults_and_scope():
    from bench.score import is_scored_memo

    assert ClipResult(1, "command", "stop", "stop", 0.1).memo == "unknown"
    assert is_scored_memo("gym-1") and is_scored_memo("transit-2")
    assert not is_scored_memo("quiet-1")
