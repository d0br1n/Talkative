# Background-jobs spike

Records how a headless Claude Code process (`claude -p` over stream-json) behaves
when it starts background work and keeps receiving user messages. Findings are in
`docs/findings/background-subagents.md`.

## Run

    python3 spikes/background-jobs/check.py                    # subagent variant
    python3 spikes/background-jobs/check.py --variant bash     # Bash run_in_background variant

Standard library only. Needs `claude` on PATH, logged in. It runs in a fresh temp
directory with `--permission-mode bypassPermissions` (only inside that directory),
model `sonnet`. Each run takes about 3 minutes and writes every stdout line with a
timestamp to `spikes/background-jobs/events.jsonl` (git-ignored, overwritten per run).

**This spends a little of your Claude usage** (a few cents of Sonnet on paper; the
stream reported roughly 0.36 USD of API-equivalent cost per run because of the large
session context).
