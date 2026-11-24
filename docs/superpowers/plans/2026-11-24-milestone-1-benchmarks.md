# Milestone 1: Engine Benchmark and Background-Subagent Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick the speech engines for both deployment shapes, using the owner's own voice recorded at the gym and in transit. Also find out whether a headless Claude Code coordinator can run background subagents while it keeps talking.

**Architecture:** A small Python benchmark package (`bench/`) does five jobs:
1. turns the owner's Voice Memos into labelled clips;
2. runs each speech-to-text (STT) engine over them, one engine at a time;
3. times each text-to-speech (TTS) engine;
4. scores results against the spec's accuracy and latency bars;
5. writes a Markdown report per machine.

A separate Bun/TypeScript spike (`spikes/background-jobs/`) drives `claude -p` over stream-json and records what happens when background subagents run.

**Tech Stack:** Python 3.11+, uv, pytest, sherpa-onnx (VAD, Parakeet, Moonshine, Kokoro, Piper-voice VITS: Apache-2.0, aarch64 and x86-64 wheels), faster-whisper (MIT), soundfile, numpy, jiwer (Apache-2.0), ffmpeg (system). Bun ≥ 1.2 for the spike.

**Spec:** [`docs/specs/2026-11-24-phone-voice-agent-design.md`](../../specs/2026-11-24-phone-voice-agent-design.md), milestone 8.1, with constraints 5.3 and 5.4.

## Global Constraints

- Local engines only. No network calls to any speech API. Downloading models once is allowed. (Spec 4.1)
- No GPL code in the project. Piper voices run through sherpa-onnx's VITS runtime, not the GPL `piper1-gpl` package. (Spec 5.4)
- Must run on **aarch64 Linux, CPU only** (Oracle: 4 cores, 24 GB) and on **x86-64 Linux, with or without CUDA** (laptop: RTX 3050 Ti, ~4 GB VRAM).
- Accuracy bar: commands and "continue" recognised in **≥ 95%** of clips, word error rate **≤ 10%** on ordinary lines. (Spec 5.3)
- Latency bars, derived from spec 5.3 and sidetone's measured split. Transcription starts after 400 ms of quiet, inside a 1.5 s pause. So:
  - **STT decode p50 ≤ 1.1 s** to add nothing to the round trip;
  - **TTS first-audio p50 ≤ 0.5 s** to keep split-shape p50 ≤ 4.0 s.
- Text normalisation for word error rate (WER): lowercase, then replace every run of characters other than `[a-z0-9]` with one space, then trim. This is sidetone's rule.
- Never include the first decode of a loaded model in timings. Run one untimed warm-up first.
- Run one engine at a time in its own process. Record peak RSS. The laptop has crashed from running out of memory before.

## Review Focus

1. **The owner skips, repeats or stumbles over a card line.** Segmentation must not silently shift every later label by one. If the clip count is not 30, fail with a clear message and write the clips unlabelled for manual fixing. Test in Task 2.
2. **Gym music or train noise between lines** gets cut as an extra utterance. Drop segments shorter than 300 ms, and report the count mismatch rather than guessing. Test in Task 2.
3. **Whisper hallucinates on near-silence** ("Thank you for watching."). It must be scored as errors, never as a crash. An empty transcript must score WER 1.0 and not divide by zero. Test in Task 3.
4. **Voice Memos files are `.m4a` (AAC, 48 kHz, often stereo).** Every engine must receive 16 kHz mono float32. Test in Task 2.
5. **A model too big for the laptop** (medium.en on 4 GB VRAM next to other work) fails mid-run. A failed engine must be recorded as "failed: <reason>" in the report while the rest continue. Test in Task 5.

---

### Task 1: Repo scaffold and the reading card

**Files:**
- Create: `pyproject.toml`, `bench/__init__.py`, `bench/card.py`, `tests/test_card.py`, `docs/bench/CARD.md`, `LICENSE` (MIT), `README.md`

**Interfaces:**
- Produces: `bench.card.LINES: list[CardLine]`, with `CardLine(id: int, text: str, kind: Literal["command","ordinary"])`. Also `bench.card.COMMANDS: set[str]`, the normalised text of the command lines.

- [ ] **Step 1: Write the failing test**

```python
from bench.card import LINES, COMMANDS
def test_card_shape():
    assert len(LINES) == 30
    assert [l.id for l in LINES] == list(range(1, 31))
    assert sum(l.kind == "command" for l in LINES) == 11
    assert "continue" in COMMANDS and "stop" in COMMANDS
```

- [ ] **Step 2: Run `uv run pytest tests/test_card.py -v`.** Expected: FAIL (module missing).

- [ ] **Step 3: Implement `bench/card.py` with exactly these lines, in this order** (the kind is in brackets):

```
1  [command]  continue
2  [ordinary] Ask the coordinator what the refactor subagent is doing right now.
3  [command]  stop
4  [ordinary] Is the LiveKit server still running on the Oracle box?
5  [ordinary] Let's keep the speech models off the laptop because of the memory crashes.
6  [command]  new conversation
7  [ordinary] Have a subagent write the tests first, then run them in the background.
8  [ordinary] What did the Whisper benchmark say about word error rate on small dot en?
9  [command]  continue
10 [ordinary] Don't read the diff out loud, just tell me if it touches the gate.
11 [ordinary] Push the branch and open a pull request, but don't merge it.
12 [command]  stop
13 [ordinary] Compare Kokoro and Piper on time to first audio.
14 [ordinary] Check Tailscale and tell me whether the phone can reach the voice side.
15 [command]  audio off
16 [ordinary] The round trip was three point eight seconds, which is fine for now.
17 [ordinary] Rebase the worktree onto main and resolve the conflicts in session dot ts.
18 [command]  continue
19 [ordinary] Why did the agent host restart the coordinator ten minutes ago?
20 [ordinary] Use Sonnet for this one and keep the effort on default.
21 [command]  switch project
22 [ordinary] Summarise what happened while I was in the tunnel.
23 [ordinary] Add a to-do item to check SideStore before the seven day signature runs out.
24 [command]  audio on
25 [ordinary] Drop the background job that is profiling the memory guard.
26 [ordinary] What's the p fifty latency on the ARM CPU with Parakeet?
27 [command]  stop
28 [ordinary] Explain the trade-off between holding the gate and denying it.
29 [command]  continue
30 [ordinary] That's all for now, tell me when the build finishes.
```

`docs/bench/CARD.md` contains the owner's instructions plus the 30 lines, numbered:
- Record with iPhone Voice Memos through the earbuds' microphone.
- Read the lines in order, with a **2-second pause** between them.
- If you stumble, carry on. Do not repeat the line.
- Make one memo per location: `gym-1.m4a`, `gym-2.m4a`, `transit-1.m4a`, `transit-2.m4a`, plus `quiet-1.m4a` at a desk as a control.
- AirDrop isn't available on Linux. Copy the memos to `recordings/` by any route that doesn't use a third-party cloud, for example Files → a Tailscale-shared folder, or a USB cable.

- [ ] **Step 4: Run `uv run pytest tests/test_card.py -v`.** Expected: PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "chore: scaffold bench package and reading card"`

### Task 2: Turn memos into labelled clips

**Files:**
- Create: `bench/audio.py`, `bench/segment.py`, `bench/prepare.py`, `tests/test_segment.py`, `tests/test_audio.py`

**Interfaces:**
- Consumes: `bench.card.LINES`
- Produces:
  - `load_16k_mono(path: Path) -> np.ndarray` (float32, via an `ffmpeg` subprocess);
  - `segments_from_probs(probs: Sequence[float], frame_ms: int, threshold: float = 0.5, min_silence_ms: int = 800, min_speech_ms: int = 300) -> list[tuple[int, int]]` (start and end in ms);
  - `prepare(memo: Path, out_dir: Path) -> PrepareResult`, with `PrepareResult(labelled: bool, count: int, clips: list[Path])`.
  - Output layout: `clips/<memo-stem>/<NN>.wav`, plus `clips/<memo-stem>/manifest.json` mapping each clip to its card line id (or `null` when unlabelled).
  - `load_clips(clips_dir: Path) -> list[LabelledClip]`, with `LabelledClip(memo: str, path: Path, line_id: int | None, audio: np.ndarray)`, reading every memo folder under `clips_dir`.

- [ ] **Step 1: Write the failing tests**

```python
def test_two_utterances_split_by_long_silence():
    p = [0.9]*30 + [0.1]*30 + [0.9]*30      # 30 ms frames
    assert segments_from_probs(p, 30) == [(0, 900), (1800, 2700)]
def test_short_gap_does_not_split():
    p = [0.9]*30 + [0.1]*10 + [0.9]*30      # 300 ms gap < 800 ms
    assert len(segments_from_probs(p, 30)) == 1
def test_short_blip_dropped():
    p = [0.1]*30 + [0.9]*5 + [0.1]*30       # 150 ms of "speech": a clank
    assert segments_from_probs(p, 30) == []
def test_count_mismatch_leaves_unlabelled(tmp_path, monkeypatch):
    # stub the VAD to yield 29 segments; prepare() must not label
    ...
    assert result.labelled is False and result.count == 29
    assert all(v is None for v in json.loads(manifest.read_text()).values())
def test_load_m4a_stereo_48k(tmp_path):
    # make a 1 s 48 kHz stereo AAC file with ffmpeg's sine source
    audio = load_16k_mono(m4a)
    assert audio.dtype == np.float32 and audio.ndim == 1
    assert abs(len(audio) - 16000) < 400
```

- [ ] **Step 2: Run `uv run pytest tests/test_segment.py tests/test_audio.py -v`.** Expected: FAIL.

- [ ] **Step 3: Implement.** `segments_from_probs` is a pure function. `prepare` gets frame probabilities from sherpa-onnx's Silero VAD model, writes a WAV per segment, and labels the clips 1..30 in order only if the count is exactly 30. Otherwise it prints `"<memo>: found N utterances, expected 30 — clips written unlabelled; edit manifest.json"` and leaves the labels as `null`.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat: segment voice memos into labelled clips"`

### Task 3: Scoring

**Files:**
- Create: `bench/score.py`, `tests/test_score.py`

**Interfaces:**
- Consumes: `bench.card.LINES`, `bench.card.COMMANDS`
- Produces:
  - `normalise(s: str) -> str`;
  - `wer(ref: str, hyp: str) -> float`;
  - `command_hit(ref: str, hyp: str) -> bool`, which is true when `normalise(ref)` appears as a whole-word substring of `normalise(hyp)`;
  - `summarise(rows: list[ClipResult]) -> EngineScore`, with:
    - `ClipResult(line_id: int, kind: str, ref: str, hyp: str, decode_s: float)`;
    - `EngineScore(wer_ordinary: float, command_rate: float, decode_p50: float, decode_p95: float, passes: bool, reasons: list[str])`.

- [ ] **Step 1: Write the failing tests**

```python
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
```

`rows_with` is a small helper in the test file that builds synthetic rows hitting the given aggregates.

- [ ] **Step 2: Run `uv run pytest tests/test_score.py -v`.** Expected: FAIL.

- [ ] **Step 3: Implement.** Use `jiwer.wer` on normalised strings. Treat an empty reference as WER 0 if the hypothesis is empty, and 1 otherwise. The bars are module constants: `MAX_WER = 0.10`, `MIN_COMMAND_RATE = 0.95`, `MAX_STT_P50_S = 1.1`.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat: scoring against spec accuracy and latency bars"`

### Task 4: STT engine adapters

**Files:**
- Create: `bench/stt.py`, `tests/test_stt.py`, `scripts/fetch_models.sh`

**Interfaces:**
- Produces:
  - `class SttEngine(Protocol): name: str; def load(self) -> None; def transcribe(self, audio: np.ndarray, prompt: str | None) -> str`
  - `ENGINES: dict[str, Callable[[], SttEngine]]`, with keys:
    - `whisper-tiny.en`, `whisper-base.en`, `whisper-small.en`, `whisper-medium.en`: faster-whisper. `int8` on CPU; `float16` on CUDA when `ctranslate2.get_cuda_device_count() > 0`; `beam_size=1`; `vad_filter=False`, because the clips are already segmented.
    - `parakeet-tdt-0.6b`: sherpa-onnx offline NeMo transducer, int8.
    - `moonshine-base`: sherpa-onnx offline Moonshine, int8.
  - `class ModelMissing(Exception)`, raised by `load()` when model files are absent.
  - `VOCAB_PROMPT: str`, a comma-separated list of the card's project words, passed as faster-whisper's `initial_prompt`. sherpa-onnx engines ignore it. Sidetone found the prompt halves Whisper's errors.
- `scripts/fetch_models.sh` downloads the sherpa-onnx model archives from the k2-fsa/sherpa-onnx GitHub releases into `models/`. Pin exact archive names after checking the release page: parakeet-tdt-0.6b-v2 int8, moonshine-base-en int8, silero_vad.onnx, kokoro-en, and one vits-piper `en_US` medium voice. Check that each Piper voice's licence permits redistribution of its outputs.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.parametrize("name", list(ENGINES))
def test_engine_transcribes_fixture(name, fixture_clip):
    eng = ENGINES[name](); 
    try: eng.load()
    except ModelMissing: pytest.skip(f"{name} not downloaded")
    text = eng.transcribe(fixture_clip, VOCAB_PROMPT)
    assert "stop" in normalise(text)
```

`fixture_clip` is `tests/fixtures/stop.wav`: the owner's line 3 from `quiet-1`, copied in once the recordings exist. Until then, use a 16 kHz recording of the implementer saying "stop".

- [ ] **Step 2: Run `uv run pytest tests/test_stt.py -v`.** Expected: FAIL (module missing).

- [ ] **Step 3: Implement the adapters.** `load()` raises `ModelMissing` with the expected path when model files are absent.

- [ ] **Step 4: Run `bash scripts/fetch_models.sh && uv run pytest tests/test_stt.py -v`.** Expected: PASS for every engine, or SKIP for engines not fetched.

- [ ] **Step 5: Commit.** `git commit -am "feat: STT adapters for whisper, parakeet, moonshine"`

### Task 5: TTS adapters and the bench runner

**Files:**
- Create: `bench/tts.py`, `bench/run.py`, `bench/report.py`, `tests/test_tts.py`, `tests/test_run.py`

**Interfaces:**
- Consumes: `SttEngine`, `ENGINES`, `summarise`, `prepare` output layout
- Produces:
  - `class TtsEngine(Protocol): name: str; def load(self) -> None; def first_audio_s(self, sentence: str) -> float`, which measures from the call until the first PCM chunk. sherpa-onnx's generate callback gives the first chunk.
  - `TTS_ENGINES` keys: `kokoro`, `piper-medium`.
  - `run_stt(engine: SttEngine, clips: list[LabelledClip]) -> list[ClipResult]`: does the warm-up, then times each labelled clip.
  - `run_stt_cli(engine: str, clips: Path, out: Path) -> Path`: the CLI body. It catches any exception from `load()` or decoding and writes `{"status": "failed: <ExcName>: <msg>"}`.
  - `report(results_dir: Path) -> str`: the Markdown report.
  - CLI `uv run python -m bench.run stt --clips clips/ --engine <name> --out results/<host>/<engine>.json`. **One engine per process.** Records peak RSS from `resource.getrusage`, plus peak VRAM via `nvidia-smi` when present.
  - CLI `uv run python -m bench.run tts --engine <name> --out ...`. Uses the 19 ordinary card lines as sentences.
  - CLI `uv run python -m bench.report results/<host>/ > docs/bench/results-<host>.md`, which writes one table each for STT and TTS, with ✅ or ❌ per bar and the reasons.
  - `scripts/run_all.sh`, which loops over engines with one process each and continues past failures.

- [ ] **Step 1: Write the failing tests**

```python
def test_warmup_not_timed(fake_engine):
    rows = run_stt(fake_engine, clips)      # fake: first call sleeps 0.7 s, rest 0.1 s
    assert max(r.decode_s for r in rows) < 0.5
def test_failed_engine_recorded(tmp_path):
    out = run_stt_cli(engine="boom", ...)   # engine whose load() raises MemoryError
    assert json.loads(out.read_text())["status"].startswith("failed: MemoryError")
def test_report_marks_bars(tmp_path):
    md = report(results_dir_with_one_passing_one_failing)
    assert "✅" in md and "❌" in md and "WER" in md
def test_tts_first_audio_positive(tts_engine):  # skip if model missing
    assert 0 < tts_engine.first_audio_s("Short first sentence.") < 30
```

- [ ] **Step 2: Run `uv run pytest tests/test_tts.py tests/test_run.py -v`.** Expected: FAIL.

- [ ] **Step 3: Implement.** Per engine: one untimed warm-up decode on the first clip, then time each labelled clip. Clips with a `null` label are skipped and counted in the report. For TTS, the bar is `MAX_TTS_FIRST_AUDIO_P50_S = 0.5`.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat: bench runner, TTS timing, per-host report"`

### Task 6: Background-subagent spike

**Files:**
- Create: `spikes/background-jobs/check.ts`, `spikes/background-jobs/README.md`, `docs/findings/background-subagents.md`

**Interfaces:**
- Produces: a findings document that answers the three questions in spec 8.1 with evidence (event excerpts), plus a recommendation for the agent host plan.

This is a spike: it records behaviour rather than asserting it. Its deliverable is the findings document.

- [ ] **Step 1: Write `check.ts`.** It spawns `claude -p --input-format stream-json --output-format stream-json --verbose --model sonnet` in a temp directory, and appends every stdout line to `events.jsonl` with a receive timestamp. Then it sends three user messages:
  - **t = 0:** "Start a background subagent that runs `sleep 90 && echo JOB-DONE` with Bash and reports its output. Don't wait for it; reply 'started' immediately."
  - **t = first `result` event + 5 s:** "While that runs: what is 17 times 23?"
  - **t = +120 s:** nothing. Keep reading stdout for up to 60 s more.

- [ ] **Step 2: Run `bun spikes/background-jobs/check.ts`** with the owner's normal Claude Code login. Expected: the run completes and `events.jsonl` exists. Cost: a few cents of Sonnet.

- [ ] **Step 3: Answer from `events.jsonl`, and write `docs/findings/background-subagents.md`:**
  - (a) Did the second question get its `result` before `JOB-DONE` appeared?
  - (b) Which event type, if any, signals the job's completion without a new user message, and does it start a new assistant turn by itself?
  - (c) Does the process stay alive, and does stdin stay accepted, while a background job runs and no turn is active?

  If (b) is "nothing", repeat with the job run as Bash `run_in_background` instead of a subagent, and record that result. Add a recommendation:
  - **(i)** rely on the coordinator's own background jobs, naming the event the host should watch for; or
  - **(ii)** the host runs each job as its own `claude -p` process and reports to the coordinator, as the spec's fallback.

- [ ] **Step 4: Commit.** `git add spikes docs/findings && git commit -m "spike: background subagents under headless stream-json"`

### Task 7: Run on both machines and write the decision

Needs the owner: the recordings (Task 1 card), and shell access to the Oracle box.

**Files:**
- Create: `docs/bench/results-oracle.md`, `docs/bench/results-laptop.md`, `docs/bench/DECISION.md`

- [ ] **Step 1: Prepare the clips on the laptop.** For each memo, run `uv run python -m bench.prepare recordings/<memo>.m4a clips/`. Expected: "30 utterances, labelled" for each memo, or manifests fixed by hand.
- [ ] **Step 2: Run on Oracle.** Copy the repo, `clips/` and `models/`. Run `uv sync && bash scripts/run_all.sh oracle`. Expected: `docs/bench/results-oracle.md` written, with every engine either scored or marked failed.
- [ ] **Step 3: Run on the laptop.** Close the agents first. Run `bash scripts/run_all.sh laptop`. Expected: `docs/bench/results-laptop.md`.
- [ ] **Step 4: Write `DECISION.md`.**
  - The chosen STT and TTS engines for the split shape and for the single-machine shape, each with its numbers against the bars.
  - The split-shape round trip estimated as 1.5 s + max(0, STT p50 − 1.1 s) + 1.6 s + TTS first-audio p50 + 0.2 s, compared with the 4.0 s target.
  - If no CPU engine passes both bars, state that, per spec 5.3, and **stop for the owner's decision**.
  - The background-jobs recommendation from Task 6.
- [ ] **Step 5: Commit.** `git commit -am "docs: milestone 1 results and engine decision"`

---

## After this plan

Separate plans will follow, each written once milestone 1 has decided its inputs:
1. Voice side + agent side in both shapes, tested with a fake phone. This depends on the engine choice and the Task 6 recommendation.
2. The iOS app with CI and SideStore.

The Smart Turn v3 end-of-turn model is not benchmarked here. Sidetone measured it at about 12 ms on CPU, and it needs streaming audio with real pauses, so it is timed in plan 1 on the Oracle box.
3. Dropouts, what-you-missed, the memory guard, and the approval gate.
