# Deploying Talkative

Two programs: `voice` (speech, pairing, LiveKit room, the link server the agent dials) and
`agent` (the Claude CLI in your project). LiveKit runs in Docker next to `voice`.
Everything lives in `~/.talkative/` (override with `TALKATIVE_HOME`): `config.json`,
`keys.json`, `livekit.yaml` and `code` are mode 600, the directory is 700.

`bind` is one address, never `0.0.0.0`: `init` and `loadConfig` refuse it.

The steps below set up one machine first (the simplest shape); the split shape, with the
agent on a laptop, is at the end. Every command runs from the repository root, as the user
who will run the services.

## Prerequisites

- Linux, x86-64 or aarch64.
- [Bun](https://bun.sh) in `~/.bun/bin` (the units run `%h/.bun/bin/bun`).
- [uv](https://docs.astral.sh/uv/), for the Python speech worker.
- Docker, usable by your user without `sudo` (LiveKit runs in it).
- Tailscale, up and logged in (`tailscale ip -4` prints this host's address). For a local
  test only, `127.0.0.1` works instead; a phone cannot reach it.
- Claude Code installed and logged in **as the same user** who runs the agent (`claude` works
  in a terminal). The agent runs your normal login; it never uses `--bare`.
- `curl` and `tar` (the model download), and `ffmpeg` only if you play WAVs with the fake phone.

## Single machine

1. Install the dependencies and the speech models:

       bun install
       uv sync
       scripts/fetch_models.sh

   `uv sync` makes `.venv/`, the Python the voice runs (`voice.python` in `config.json`).
   `fetch_models.sh` downloads every benchmark model into `models/` (a few GB; it skips what is
   there). The voice needs two of them: `models/sherpa-onnx-moonshine-base-en-int8`
   (`moonshine-base`, STT) and `models/vits-piper-en_US-lessac-medium` (`piper-medium`, TTS).

2. Write the config. `--project` is the (existing) directory Claude Code works in; `--bind` is this host's
   Tailscale IP (or `127.0.0.1` for a local test):

       bun src/main.ts init --bind "$(tailscale ip -4)" --project ~/code/myproject

   It writes `~/.talkative/config.json`, with a fresh `linkSecret`. It refuses to overwrite an
   existing config; `--force` does, and rotates the secret (a copied agent config then stops
   working).

3. Configure and start LiveKit:

       bun src/main.ts livekit

   It writes `~/.talkative/livekit.yaml` and prints a `docker run` command. Run that command
   as printed. The container is named `livekit` and restarts with Docker (`--restart
   unless-stopped`), so it needs no unit of its own.

4. Start both sides by hand first, each in its own terminal, and watch their logs:

       bun src/main.ts voice     # waits for LiveKit, loads the models, then: voice: ready. pairing code: ...
       bun src/main.ts agent     # agent: started in <project>, dialling ws://<bind>:7891, then: agent: link up

   If `claude` is not on your `PATH` (or you want a different one), set `TALKATIVE_CLAUDE` to
   its full path before starting the agent.

5. Check it works with the fake phone (it pairs, joins the room as the phone, and prints one
   JSON line per event). With both sides still running:

       bun scripts/fake-phone.ts --pair "http://$(tailscale ip -4):7890" --code "$(bun src/main.ts code)" \
         --text "What is two plus two?" --wait 30

   (Use `http://127.0.0.1:7890` if you bound to `127.0.0.1`.) Expect `joined`, a `status` with
   `"agent":"ready"`, then `sentence` lines with the answer and a `firstAudio`. This is a real
   Claude turn and costs a few cents. A `status` with `"agent":"down"` or an `error` line means
   the agent is not linked or claude cannot start: the agent's log says why.

   Each successful pair changes the pairing code: run `bun src/main.ts code` again for the
   next phone.

6. Stop both (ctrl-c), then install them as user units. Edit `WorkingDirectory` in both
   files if the repository is not at `~/Talkative`:

       mkdir -p ~/.config/systemd/user
       cp deploy/talkative-voice.service deploy/talkative-agent.service ~/.config/systemd/user/
       systemctl --user daemon-reload
       systemctl --user enable --now talkative-voice talkative-agent
       loginctl enable-linger "$USER"

   **`loginctl enable-linger` is required**: without it, user units stop when you log out and
   do not start at boot. On a server you reach over SSH this is essential.

   The agent unit's `PATH` is `~/.local/bin:~/.bun/bin:/usr/local/bin:/usr/bin:/bin`. If
   `claude` lives elsewhere, uncomment `Environment=TALKATIVE_CLAUDE=...` in
   `talkative-agent.service` and set its full path.

   Logs: `journalctl --user -u talkative-voice -f` and `journalctl --user -u talkative-agent -f`.
   `bun src/main.ts code` prints the current pairing code.

## Split shape: voice and LiveKit on a server, agent on the laptop

The server does steps 1 to 3 and runs only `voice` (step 4, then its unit in step 6, with
`enable-linger`). `--project` in `init` does not matter there.

The laptop needs Bun, `bun install`, and Claude Code logged in; not uv, the models or Docker.

1. Copy the server's `~/.talkative/config.json` to the laptop's `~/.talkative/config.json`
   (keep it mode 600 and the directory 700). It holds the shared `linkSecret`: the server
   refuses an agent with any other (close code 4001, logged on both ends). Do not run `init`
   on the laptop: it would write a new secret.
2. In the copy, set `agent.project` to the laptop's project directory. `agent.voiceUrl` stays
   `ws://<server-tailscale-ip>:7891`.
3. Run `bun src/main.ts agent` by hand (it logs `agent: link up`), then install only
   `talkative-agent.service` as in step 6, with `loginctl enable-linger` if it should keep
   running while you are logged out. The agent redials whenever the link drops (a sleeping
   laptop, a restarted server).
4. Check from either machine with the fake phone, pairing against the server's address.

## LiveKit

The printed command runs `livekit/livekit-server:v1.13.11`, the version the end-to-end test
(`test/e2e/README.md`) runs against; change the tag deliberately and rerun that test.
`livekit.yaml` binds the signalling port (7880) and the ICE UDP ports (50000-50019) to `bind`
alone, and turns ICE over TCP off (`tcp_port: 0`): livekit cannot bind its TCP listener to one
address, and Tailscale carries the phone's UDP even when it relays through DERP.

## Pairing

The phone posts the three-word code to `http://<bind>:7890/pair` and receives a 30-day room token.
Five wrong codes in 60 s lock pairing for 60 s. The code changes each time `voice` starts and
after each successful pair; `bun src/main.ts code` prints the current one.

## Phone log

What the iPhone app reports (its `log` messages) is appended to `~/.talkative/phone.log` (mode 600),
one line each: `<UTC time> <info|error> <text>`, with newlines and control characters escaped. Lines
are cut at 2 KB, at most 20 a second are kept (the rest are counted in a `dropped N lines` line), and
at 5 MB the file moves to `phone.log.1`. Read it with `tail -f ~/.talkative/phone.log`.
