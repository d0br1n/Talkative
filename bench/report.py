"""Render a host's results directory as Markdown: `python -m bench.report results/<host>/`."""

import json
import sys
from pathlib import Path

from bench.score import (
    COMMANDS,
    MAX_STT_P50_S,
    ClipResult,
    _corpus_wer,
    command_hit,
    is_scored_memo,
)

# Split-shape round trip estimate (seconds), from the milestone 1 plan: 1.5 + max(0, STT p50 - 1.1)
# + 1.6 + TTS first-audio p50 + 0.2, shown against the 4.0 s target.
RT_FIXED_BEFORE_STT_S = 1.5
RT_AGENT_S = 1.6
RT_TRANSPORT_S = 0.2
RT_TARGET_S = 4.0


def _load(results_dir: Path) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted(results_dir.glob("*.json"))]


def _fmt(value, spec: str = ".2f", suffix: str = "") -> str:
    return "n/a" if value is None else f"{value:{spec}}{suffix}"


def _memo_cell(rows: list[dict]) -> str:
    if not rows:
        return "n/a"
    results = [ClipResult(**{k: r[k] for k in ClipResult.__dataclass_fields__ if k in r}) for r in rows]
    ordinary = [r for r in results if r.kind == "ordinary"]
    commands = [r for r in results if r.kind == "command"]
    wer = f"{_corpus_wer(ordinary):.3f}" if ordinary else "n/a"
    cmd = f"{sum(command_hit(r.ref, r.hyp) for r in commands) / len(commands):.2f}" if commands else "n/a"
    return f"n={len(results)}, WER {wer}, cmd {cmd}"


def _round_trip(stt_p50: float, tts_p50: float) -> float:
    return (RT_FIXED_BEFORE_STT_S + max(0.0, stt_p50 - MAX_STT_P50_S)
            + RT_AGENT_S + tts_p50 + RT_TRANSPORT_S)


def report(results_dir: Path) -> str:
    results = _load(Path(results_dir))
    stt = [r for r in results if r.get("kind", "stt") == "stt"]
    tts = [r for r in results if r.get("kind") == "tts"]
    host = next((r["host"] for r in results if r.get("host")), Path(results_dir).name)
    lines = [f"# Bench results: {host}", ""]

    lines += ["## Speech to text", "",
              "| Engine | Device | WER ordinary | Command rate | Decode p50 (s) | Decode p95 (s) "
              "| Peak RSS (MB) | Peak VRAM (MB) | Verdict |",
              "|---|---|---|---|---|---|---|---|---|"]
    failed: list[tuple[str, str]] = []
    skipped = 0
    for r in stt:
        if r["status"] != "ok":
            failed.append((r["engine"], r["status"]))
            continue
        skipped = max(skipped, r.get("skipped_unlabelled", 0))
        verdict = "✅" if r["passes"] else "❌ " + "; ".join(r["reasons"])
        lines.append(
            f"| {r['engine']} | {r.get('device') or 'n/a'} | {_fmt(r['wer_ordinary'], '.3f')} "
            f"| {_fmt(r['command_rate'], '.3f')} | {_fmt(r['decode_p50'])} | {_fmt(r['decode_p95'])} "
            f"| {_fmt(r.get('peak_rss_mb'), '.0f')} | {_fmt(r.get('peak_vram_mb'), '.0f')} | {verdict} |")
    if skipped:
        lines += ["", f"Unlabelled clips skipped: {skipped}."]
    lines += ["", "The STT verdict is computed on gym and transit clips only. The quiet control is "
              "shown in the per-memo table and excluded from pass/fail."]

    ok_stt = [r for r in stt if r["status"] == "ok"]
    if ok_stt:
        commands_seen = [c for c in COMMANDS
                         if any(c in r.get("command_hits", {}) for r in ok_stt)]
        if commands_seen:
            lines += ["", "### Command hits (gym and transit clips; every command needs 95%)", "",
                      "| Engine | " + " | ".join(commands_seen) + " |",
                      "|---|" + "---|" * len(commands_seen)]
            for r in ok_stt:
                hits = r.get("command_hits", {})
                cells = [f"{hits[c][0]}/{hits[c][1]}" if c in hits else "n/a" for c in commands_seen]
                lines.append(f"| {r['engine']} | " + " | ".join(cells) + " |")
        memos = sorted({row.get("memo", "unknown") for r in ok_stt for row in r["rows"]})
        if memos:
            lines += ["", "### Per memo (clips scored, WER ordinary, command rate)", "",
                      "| Engine | " + " | ".join(
                          m + ("" if is_scored_memo(m) else " (control)") for m in memos) + " |",
                      "|---|" + "---|" * len(memos)]
            for r in ok_stt:
                cells = [_memo_cell([row for row in r["rows"] if row.get("memo", "unknown") == m])
                         for m in memos]
                lines.append(f"| {r['engine']} | " + " | ".join(cells) + " |")

    lines += ["", "## Text to speech", "",
              "| Engine | Device | First audio p50 (s) | First audio p95 (s) | Verdict |",
              "|---|---|---|---|---|"]
    for r in tts:
        if r["status"] != "ok":
            failed.append((r["engine"], r["status"]))
            continue
        bar = r.get("bar_p50_s", 0.5)
        verdict = "✅" if r["passes"] else f"❌ p50 {r['first_audio_p50']:.2f}s above the {bar}s bar"
        lines.append(f"| {r['engine']} | {r.get('device') or 'n/a'} | {_fmt(r['first_audio_p50'], '.3f')} "
                     f"| {_fmt(r['first_audio_p95'], '.3f')} | {verdict} |")

    if tts:
        lines += ["", "The 0.5 s bar is the split-shape bar. TTS ran on CPU only; TTS on GPU was not measured."]
        measurement = next((r["measurement"] for r in tts if r.get("measurement")), None)
        if measurement:
            lines += ["", f"Measurement: {measurement}."]

    ok_tts = [r for r in tts if r["status"] == "ok"]
    pairs = [(a, b) for a in ok_stt if a.get("passes") for b in ok_tts if b.get("passes")]
    if pairs:
        lines += ["", "## Split-shape round-trip estimate", "",
                  f"Estimate only: {RT_FIXED_BEFORE_STT_S} s + max(0, STT p50 - {MAX_STT_P50_S}) + "
                  f"{RT_AGENT_S} s + TTS p50 + {RT_TRANSPORT_S} s, against the {RT_TARGET_S} s target. "
                  "Only pairs where both engines pass their bars are listed.", "",
                  "| STT | TTS | Estimated round trip (s) | Within target |", "|---|---|---|---|"]
        for a, b in pairs:
            rt = _round_trip(a["decode_p50"], b["first_audio_p50"])
            lines.append(f"| {a['engine']} | {b['engine']} | {rt:.2f} "
                         f"| {'✅' if rt <= RT_TARGET_S else '❌'} |")

    if failed:
        lines += ["", "## Failed engines", ""]
        lines += [f"- {name}: {status}" for name, status in failed]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m bench.report results/<host>/")
    print(report(Path(sys.argv[1])), end="")
