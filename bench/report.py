"""Render a host's results directory as Markdown: `python -m bench.report results/<host>/`."""

import json
import sys
from pathlib import Path


def _load(results_dir: Path) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted(results_dir.glob("*.json"))]


def _fmt(value, spec: str = ".2f", suffix: str = "") -> str:
    return "n/a" if value is None else f"{value:{spec}}{suffix}"


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

    lines += ["", "## Text to speech", "",
              "| Engine | First audio p50 (s) | First audio p95 (s) | Verdict |",
              "|---|---|---|---|"]
    for r in tts:
        if r["status"] != "ok":
            failed.append((r["engine"], r["status"]))
            continue
        bar = r.get("bar_p50_s", 0.5)
        verdict = "✅" if r["passes"] else f"❌ p50 {r['first_audio_p50']:.2f}s above the {bar}s bar"
        lines.append(f"| {r['engine']} | {_fmt(r['first_audio_p50'], '.3f')} "
                     f"| {_fmt(r['first_audio_p95'], '.3f')} | {verdict} |")

    if tts:
        measurement = next((r["measurement"] for r in tts if r.get("measurement")), None)
        if measurement:
            lines += ["", f"Measurement: {measurement}."]

    if failed:
        lines += ["", "## Failed engines", ""]
        lines += [f"- {name}: {status}" for name, status in failed]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m bench.report results/<host>/")
    print(report(Path(sys.argv[1])), end="")
