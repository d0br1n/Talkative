# End-to-end test

The whole system for real: LiveKit in Docker, `voice` with the speech worker
(moonshine-base and piper-medium), `agent` driving `test/fixtures/fake-claude.ts`,
and `scripts/fake-phone.ts` joining the room as the phone.

    TALKATIVE_E2E=1 bun test test/e2e

Without `TALKATIVE_E2E=1` it is skipped, so the default `bun test` stays fast.

## What it needs

- Docker, able to run `livekit/livekit-server:v1.13.11` with `--network host`.
- The models under `models/` and the Python env at `.venv/` (`scripts/fetch_models.sh`, `uv sync`).
- `ffmpeg` (the fake phone decodes WAVs with it).
- Free ports: TCP 7880, 7881, 7890, 7891 and UDP 50000-50019. The test refuses to start otherwise.

## What it does

It makes a temporary `HOME` and `TALKATIVE_HOME`, runs `init --bind 127.0.0.1` and `livekit`
there, starts LiveKit in a container named `talkative-e2e-<pid>` (removed at the end, also on
failure), then `voice`, then `agent` with `TALKATIVE_CLAUDE` pointing at a fake-claude wrapper
and `TALKATIVE_APPROVAL_TIMEOUT_MS=3000`. Logs go to `run.log` in the temporary directory; the
test prints its path.

1. `--say tests/fixtures/sentence.wav`: the phone gets a status on joining; `heard` contains
   "live kit" / "oracle"; `firstAudio` within 10 s; two `sentence` messages (fixture
   `two-sentences`). The agent is then killed: `status{agent:"down"}` within 5 s, and after a
   restart `status{agent:"ready"}`.
2. `--say sentence.wav --say stop.wav` with fixture `long-reply` (six sentences, so that the
   spoken "stop", which acts after its end-of-turn pause, lands inside the reply): not every
   sentence plays, none starts after "stop" is heard, and the voice's audio ends with it.
3. Fixture `approval`: `--decide allow` sees `approval`, sends `decide`, sees
   `approvalDone{allow:true, by:"owner"}`, and fake-claude gets an allow `control_response`.
   With `--decide none` the approval ends with `by:"timeout"`.

## The fake phone by hand

    bun scripts/fake-phone.ts --pair http://127.0.0.1:7890 --code "$(bun src/main.ts code)" \
      --text "What is two plus two?" --wait 30

It prints one JSON line per event (`heard`, `firstAudio`, `sentence`, `speaking`, `status`,
`narration`, `approval`, `decide`, `approvalDone`, ...), with `t` in seconds since the end of
the utterance it just played or the typed turn it just sent.
