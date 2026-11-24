# Deploying Talkative

Two programs: `voice` (speech, pairing, LiveKit room, the link server the agent dials) and
`agent` (the Claude CLI in your project). LiveKit runs in Docker next to `voice`.
Everything lives in `~/.talkative/` (override with `TALKATIVE_HOME`): `config.json`,
`keys.json` and `code` are mode 600, the directory is 700.

`bind` is one address, never `0.0.0.0`: `init` and `loadConfig` refuse it.

## Split shape: voice and LiveKit on a server, agent on the laptop

1. Server: `bun src/main.ts init --bind <server-tailscale-ip> --project <dir>`
2. Server: `bun src/main.ts livekit`, then run the `docker run ...` command it prints.
3. Server: install `deploy/talkative-voice.service`, enable it. `bun src/main.ts code` prints the pairing code.
4. Laptop: copy the server's `~/.talkative/config.json` (it holds the shared `linkSecret`), set
   `agent.project` to the laptop's project directory. `agent.voiceUrl` is `ws://<server-tailscale-ip>:7891`.
5. Laptop: install `deploy/talkative-agent.service`, enable it.

## Single-machine shape

Run `init` once with `--bind <this-host-tailscale-ip>` (so a phone can reach it) or `--bind 127.0.0.1`
(local testing only), then `livekit`, and enable both units on the same host. The agent dials
`ws://<bind>:7891`.

## Pairing

The phone posts the three-word code to `http://<bind>:7890/pair` and receives a 30-day room token.
Five wrong codes in 60 s lock pairing for 60 s. The code changes each time `voice` starts.
