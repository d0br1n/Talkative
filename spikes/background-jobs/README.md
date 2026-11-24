# Background-jobs spike

Records how a headless Claude Code process (`claude -p` over stream-json) behaves
when it starts background work and keeps receiving user messages. Findings are in
`docs/findings/background-subagents.md`.

## Run

    python3 spikes/background-jobs/check.py                    # subagent: 4 x sleep 20 inside one background subagent
    python3 spikes/background-jobs/check.py --variant subagent-sleep90   # blocked variant, kept for reference
    python3 spikes/background-jobs/check.py --variant bash     # Bash run_in_background variant

Standard library only. Needs `claude` on PATH, logged in. It runs in a fresh temp
directory with `--permission-mode bypassPermissions` (only inside that directory),
model `sonnet`. Each run takes about 3 minutes and writes every stdout line with a
timestamp to `spikes/background-jobs/events-<variant>.jsonl` (git-ignored, overwritten per run).

**This spends a little of your Claude usage**: the stream reports about $0.13 to $0.40 of API-equivalent cost per run (large session context from skills and hooks). The script always kills the `claude` process on exit, including on Ctrl-C (it runs with permission bypass).
