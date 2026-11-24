# Reading card

Read these 30 lines to record the benchmark clips. Commands are marked **(command)**; the rest are ordinary sentences.

## Instructions

- Record with iPhone Voice Memos through the earbuds' microphone.
- Read the lines in order, with a **2-second pause** between them.
- If you stumble, carry on. Do not repeat the line.
- Make one memo per location: `gym-1.m4a`, `gym-2.m4a`, `transit-1.m4a`, `transit-2.m4a`, plus `quiet-1.m4a` at a desk as a control.
- AirDrop isn't available on Linux. Copy the memos to `recordings/` by any route that doesn't use a third-party cloud, for example Files → a Tailscale-shared folder, or a USB cable.

## Lines

1. continue **(command)**
2. Ask the coordinator what the refactor subagent is doing right now.
3. stop **(command)**
4. Is the LiveKit server still running on the Oracle box?
5. Let's keep the speech models off the laptop because of the memory crashes.
6. new conversation **(command)**
7. Have a subagent write the tests first, then run them in the background.
8. What did the Whisper benchmark say about word error rate on small dot en?
9. continue **(command)**
10. Don't read the diff out loud, just tell me if it touches the gate.
11. Push the branch and open a pull request, but don't merge it.
12. stop **(command)**
13. Compare Kokoro and Piper on time to first audio.
14. Check Tailscale and tell me whether the phone can reach the voice side.
15. audio off **(command)**
16. The round trip was three point eight seconds, which is fine for now.
17. Rebase the worktree onto main and resolve the conflicts in session dot ts.
18. continue **(command)**
19. Why did the agent host restart the coordinator ten minutes ago?
20. Use Sonnet for this one and keep the effort on default.
21. switch project **(command)**
22. Summarise what happened while I was in the tunnel.
23. Add a to-do item to check SideStore before the seven day signature runs out.
24. audio on **(command)**
25. Drop the background job that is profiling the memory guard.
26. What's the p fifty latency on the ARM CPU with Parakeet?
27. stop **(command)**
28. Explain the trade-off between holding the gate and denying it.
29. continue **(command)**
30. That's all for now, tell me when the build finishes.

## Running the benchmark

Do these in order.

1. **Install.** `uv sync` (Python 3.12 is pinned in `.python-version`).
2. **Fetch models.** `scripts/fetch_models.sh`. Whisper weights are not part of this: faster-whisper downloads them into `models/faster-whisper` the first time an engine runs. Set `TALKATIVE_OFFLINE=1` to stop that download (a Whisper engine with no cached weights is then recorded as failed).
3. **Copy the memos** into `recordings/` (`gym-1.m4a`, `gym-2.m4a`, `transit-1.m4a`, `transit-2.m4a`, `quiet-1.m4a`).
4. **Prepare the clips.** `uv run python -m bench.prepare recordings/*.m4a clips/`. Each memo prints `<memo>: 30 utterances, labelled`, or a message saying how many utterances it found. In that case the clips are written unlabelled and the command exits non-zero. Fix the manifest by hand: open `clips/<memo>/manifest.json`, set each clip's value to its card line number (an integer 1 to 30), and set `null` for any clip to skip (a cough, a false start, a repeated line). Then re-run nothing: the runner reads the manifests as they are. Invalid ids are rejected with the file name and the bad value. `bench.prepare` refuses to overwrite a memo that already has a manifest unless you pass `--force`, which discards your edits and deletes that memo's clips first.
5. **Copy to the Oracle box** with `rsync -a` (the Hugging Face cache under `models/faster-whisper` uses symlinks, which plain `cp` or `scp` would break). Include `clips/` and `models/` along with the repo.
6. **On Oracle:** `uv sync`, then `scripts/run_all.sh oracle`. It refuses to start the STT runs, with a message, if there is no `clips/*/manifest.json`; the TTS runs still go ahead.
7. **On the laptop (optional, unverified): CUDA for float16 Whisper.** Whisper falls back to int8 on CPU if CUDA libraries cannot be loaded. For the GPU it needs the pip packages `nvidia-cublas-cu12` and `nvidia-cudnn-cu12`, for example `uv pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`, and their `lib` directories on `LD_LIBRARY_PATH`:
   `export LD_LIBRARY_PATH=$(uv run python -c "import nvidia.cublas.lib, nvidia.cudnn.lib, os; print(os.path.dirname(nvidia.cublas.lib.__file__) + ':' + os.path.dirname(nvidia.cudnn.lib.__file__))"):$LD_LIBRARY_PATH`
   This step has not been tested here. The STT table's Device column shows whether `cuda` or `cpu` was really used.
8. **Close Claude Code agents** before the laptop run, so memory pressure and CPU load do not skew the timings. Then run `scripts/run_all.sh laptop`.
9. **Reports** land in `docs/bench/results-<host>.md` (raw JSON in `results/<host>/`).

How to read the STT table: the pass/fail verdict uses the gym and transit clips only. The quiet clips are a control, shown per memo and excluded from the verdict. The command bar needs every command (`continue`, `stop`, `new conversation`, `audio off`, `audio on`, `switch project`) at 95% or better, as well as the pooled rate.

## Open licence items

- **espeak-ng (GPL-3)** is compiled into sherpa-onnx's native library, so in-process sherpa TTS loads GPL code. That is fine for this local benchmark, but it must be resolved before the voice side ships.
- **The Piper lessac voice is research-only.** Do not ship it.
