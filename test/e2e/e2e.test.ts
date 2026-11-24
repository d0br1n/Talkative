// The whole system, for real: LiveKit in Docker, the voice service with the
// speech worker, the agent host driving fake-claude, and the fake phone.
// Opt-in: TALKATIVE_E2E=1 bun test test/e2e   (needs Docker, models, ffmpeg)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync, type Subprocess } from "bun";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIVEKIT_IMAGE } from "../../src/voice/livekit";

const E2E = process.env.TALKATIVE_E2E === "1";
const REPO = join(import.meta.dir, "..", "..");
const BUN = process.execPath;
const SENTENCE = join(REPO, "tests/fixtures/sentence.wav");
const STOP = join(REPO, "tests/fixtures/stop.wav");
const TCP_PORTS = [7880, 7881, 7890, 7891];
const UDP_PORTS = Array.from({ length: 20 }, (_, i) => 50000 + i);

interface Event { event: string; t: number; at: number; [k: string]: any }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

/** Every port this run needs that something already listens on, as `ss` lines. */
function portsTaken(): string[] {
  const out = spawnSync(["ss", "-ltnupH"]).stdout.toString();
  return out.split("\n").filter((line) => {
    const cols = line.trim().split(/\s+/);
    const port = Number(cols[4]?.split(":").pop());
    return cols[0] === "tcp" ? TCP_PORTS.includes(port) : cols[0] === "udp" && UDP_PORTS.includes(port);
  });
}

class Proc {
  lines: string[] = [];
  events: Event[] = [];
  private waiters: (() => void)[] = [];
  constructor(readonly name: string, readonly p: Subprocess<"ignore", "pipe", "pipe">, log: string) {
    const drain = async (stream: ReadableStream<Uint8Array>, tag: string) => {
      const dec = new TextDecoder();
      let rest = "";
      for await (const chunk of stream) {
        rest += dec.decode(chunk, { stream: true });
        const parts = rest.split("\n");
        rest = parts.pop() ?? "";
        for (const line of parts) {
          appendFileSync(log, `${new Date().toISOString()} ${name}${tag} ${line}\n`);
          this.lines.push(line);
          if (line.startsWith("{\"event\"")) {
            try { this.events.push({ ...JSON.parse(line), at: performance.now() }); } catch {}
          }
          for (const w of this.waiters.splice(0)) w();
        }
      }
    };
    void drain(p.stdout, "");
    void drain(p.stderr, "!");
  }
  /** Resolve once `cond` holds, checked on every new line. */
  async until<T>(cond: () => T | undefined | false, ms: number, what: string): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = cond();
      if (v) return v;
      const left = end - Date.now();
      if (left <= 0 || this.p.exitCode !== null && !cond()) {
        throw new Error(`${this.name}: timed out waiting for ${what}; last lines:\n${this.lines.slice(-25).join("\n")}`);
      }
      await Promise.race([new Promise<void>((r) => this.waiters.push(r)), Bun.sleep(Math.min(left, 250))]);
    }
  }
  async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    if (this.p.exitCode !== null || this.p.signalCode) return;
    this.p.kill(signal);
    await Promise.race([this.p.exited, Bun.sleep(8000)]);
    if (this.p.exitCode === null && !this.p.signalCode) this.p.kill("SIGKILL");
    await this.p.exited;
  }
}

describe.skipIf(!E2E)("end to end", () => {
  const tmp = E2E ? mkdtempSync(join(tmpdir(), "talkative-e2e-")) : "";
  const home = join(tmp, "home");
  const talkHome = join(home, ".talkative");
  const project = join(tmp, "project");
  const log = join(tmp, "run.log");
  const container = `talkative-e2e-${process.pid}`;
  let containerStarted = false;
  let voice: Proc;
  let agent: Proc | null = null;
  const phones: Proc[] = [];
  let code = "";
  const env = (extra: Record<string, string> = {}) => ({
    ...process.env, HOME: home, TALKATIVE_HOME: talkHome, TALKATIVE_APPROVAL_TIMEOUT_MS: "3000", ...extra,
  });

  const removeContainer = () => {
    if (containerStarted) spawnSync(["docker", "rm", "-f", container]);
    containerStarted = false;
  };
  // a crash of this runner still takes the container down
  process.on("exit", removeContainer);

  function spawn(name: string, cmd: string[], extra: Record<string, string> = {}): Proc {
    const p = Bun.spawn(cmd, { cwd: REPO, env: env(extra), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    return new Proc(name, p, log);
  }

  /** A TALKATIVE_CLAUDE that runs fake-claude on one fixture. */
  function fakeClaude(fixture: string): string {
    const path = join(tmp, `claude-${fixture}.sh`);
    writeFileSync(path, `#!/bin/sh\nexec "${BUN}" "${join(REPO, "test/fixtures/fake-claude.ts")}" ${fixture} "$@"\n`);
    chmodSync(path, 0o755);
    return path;
  }

  async function startAgent(fixture: string, claudeLog = join(tmp, `fake-claude-${fixture}.log`)): Promise<string> {
    agent = spawn("agent", [BUN, "src/main.ts", "agent"], { TALKATIVE_CLAUDE: fakeClaude(fixture), FAKE_CLAUDE_LOG: claudeLog });
    await agent.until(() => agent!.lines.some((l) => l.includes("agent: link up")), 20_000, "agent link up");
    return claudeLog;
  }

  function phone(...extra: string[]): Proc {
    const p = spawn("phone", [BUN, "scripts/fake-phone.ts", "--pair", "http://127.0.0.1:7890", "--code", code, ...extra]);
    phones.push(p);
    return p;
  }

  const after = (p: Proc, from: Event | undefined, name: string) =>
    p.events.filter((e) => e.event === name && (!from || e.at >= from.at));

  beforeAll(async () => {
    try {
      for (const need of ["models/sherpa-onnx-moonshine-base-en-int8", "models/vits-piper-en_US-lessac-medium", ".venv/bin/python"]) {
        if (!existsSync(join(REPO, need))) throw new Error(`e2e needs ${need}`);
      }
      for (const tool of [["docker", "version"], ["ffmpeg", "-version"]]) {
        if (spawnSync(tool).exitCode !== 0) throw new Error(`e2e needs ${tool[0]}`);
      }
      const taken = portsTaken();
      if (taken.length) throw new Error(`ports in use:\n${taken.join("\n")}`);
      mkdirSync(project, { recursive: true });
      writeFileSync(log, "");
      console.log(`e2e: logs in ${log}`);

      const run = (cmd: string[]) => {
        const r = spawnSync(cmd, { cwd: REPO, env: env() });
        if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${r.stderr.toString()}`);
        return r.stdout.toString();
      };
      run([BUN, "src/main.ts", "init", "--bind", "127.0.0.1", "--project", project]);
      run([BUN, "src/main.ts", "livekit"]);
      const yaml = join(talkHome, "livekit.yaml");
      const started = spawnSync(["docker", "run", "-d", "--name", container, "--network", "host",
        "-v", `${yaml}:/livekit.yaml:ro`, LIVEKIT_IMAGE, "--config", "/livekit.yaml"]);
      if (started.exitCode !== 0) throw new Error(`docker run failed: ${started.stderr.toString()}`);
      containerStarted = true;
      const until = Date.now() + 30_000;
      for (;;) {
        try {
          if ((await fetch("http://127.0.0.1:7880/")).ok) break;
        } catch {}
        if (Date.now() > until) throw new Error(`livekit never came up:\n${spawnSync(["docker", "logs", container]).stderr}`);
        await Bun.sleep(250);
      }
      appendFileSync(log, `--- ss -ltnup with livekit up\n${spawnSync(["ss", "-ltnup"]).stdout}\n`);

      voice = spawn("voice", [BUN, "src/main.ts", "voice"]);
      await voice.until(() => voice.lines.some((l) => l.startsWith("voice: ready")), 120_000, "voice ready");
      code = readFileSync(join(talkHome, "code"), "utf8").trim();
      await startAgent("two-sentences");
    } catch (e) {
      await agent?.stop().catch(() => {});
      await voice?.stop().catch(() => {});
      removeContainer();
      throw e;
    }
  }, 180_000);

  afterAll(async () => {
    for (const p of phones) await p.stop().catch(() => {});
    await agent?.stop().catch(() => {});
    await voice?.stop().catch(() => {});
    removeContainer();
  }, 60_000);

  test("a spoken turn is heard, answered aloud, and the agent's loss and return reach the phone", async () => {
    const p = phone("--say", SENTENCE, "--wait", "60");
    // the voice brings a phone up to date as it joins
    const joinedStatus = await p.until(() => p.events.find((e) => e.event === "status"), 10_000, "status on join");
    expect(joinedStatus.agent).toBe("ready");
    const heard = await p.until(() => p.events.find((e) => e.event === "heard"), 30_000, "heard");
    appendFileSync(log, `--- ss -tunap with the phone in the room\n${spawnSync(["ss", "-tunap"]).stdout}\n`);
    const text = norm(heard.text);
    expect((text.includes("livekit") && text.includes("oracle")) || text.includes("live kit")).toBe(true);
    const first = await p.until(() => p.events.find((e) => e.event === "firstAudio" && e.t >= 0), 15_000, "firstAudio");
    console.log(`e2e: firstAudio ${first.t.toFixed(2)} s after the utterance ended`);
    expect(first.t).toBeLessThan(10);
    const sentences = await p.until(() => {
      const s = p.events.filter((e) => e.event === "sentence" && e.turnId.startsWith("o-"));
      return s.length >= 2 && s;
    }, 15_000, "two sentences");
    expect(sentences.map((s) => s.text)).toEqual(["Two short sentences.", "The second one is here."]);

    await Bun.sleep(4000); // let the reply finish playing
    const killed = performance.now();
    await agent!.stop("SIGKILL");
    const down = await p.until(() => p.events.find((e) => e.event === "status" && e.agent === "down" && e.at >= killed), 5000, "status down");
    console.log(`e2e: status down ${((down.at - killed) / 1000).toFixed(2)} s after the kill`);
    const restarted = performance.now();
    await startAgent("two-sentences");
    await p.until(() => p.events.find((e) => e.event === "status" && e.agent === "ready" && e.at >= restarted), 10_000, "status ready");
    await Bun.sleep(1000);
    expect(p.events.filter((e) => e.event === "status").at(-1)?.agent).toBe("ready");
    await p.stop();
  }, 120_000);

  test("saying stop during a reply stops the playback", async () => {
    // a reply long enough that the spoken stop (heard after its end-of-turn pause) lands inside it
    await agent!.stop();
    await startAgent("long-reply");
    const p = phone("--say", SENTENCE, "--say", STOP, "--wait", "6");
    await p.until(() => p.events.find((e) => e.event === "lastAudio"), 60_000, "the run to end");
    await p.p.exited;
    console.log(`e2e: barge-in run ${JSON.stringify(p.events.map(({ at, ...e }) => e))}`);
    expect(p.events.filter((e) => e.event === "played").length).toBe(2);
    const stopHeard = p.events.find((e) => e.event === "heard" && norm(e.text) === "stop");
    expect(stopHeard).toBeDefined();
    const sentences = p.events.filter((e) => e.event === "sentence" && e.turnId.startsWith("o-"));
    const speaking = p.events.filter((e) => e.event === "speaking" && e.turnId.startsWith("o-"));
    expect(sentences.length).toBe(6);
    expect(speaking.length).toBeGreaterThan(0);
    // the reply was cut: not every sentence played, and none started after the stop
    expect(speaking.length).toBeLessThan(sentences.length);
    expect(after(p, stopHeard, "speaking").length).toBe(0);
    // t counts from the end of stop.wav: the voice's audio ends with the stop, give or take network jitter
    const last = p.events.find((e) => e.event === "lastAudio")!;
    console.log(`e2e: stop heard at ${stopHeard!.t} s, last audio at ${last.last} s after stop.wav ended`);
    expect(last.last).not.toBeNull();
    expect(last.last).toBeLessThan(stopHeard!.t + 0.5);
  }, 90_000);

  test("an approval reaches the phone, the owner's answer reaches claude, and an unanswered one times out", async () => {
    await agent!.stop();
    const claudeLog = await startAgent("approval");

    const yes = phone("--text", "push it", "--decide", "allow", "--wait", "4");
    await yes.p.exited;
    const approval = yes.events.find((e) => e.event === "approval");
    expect(approval?.tool).toBe("Bash");
    expect(yes.events.find((e) => e.event === "decide")).toMatchObject({ id: approval!.id, allow: true });
    expect(yes.events.find((e) => e.event === "approvalDone")).toMatchObject({ id: approval!.id, allow: true, by: "owner" });
    const responses = readFileSync(claudeLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      .filter((l) => l.stdin?.type === "control_response");
    expect(responses.length).toBe(1);
    expect(responses[0].stdin.response.response.behavior).toBe("allow");

    const none = phone("--text", "push it again", "--wait", "8");
    await none.p.exited;
    expect(none.events.find((e) => e.event === "approval")).toBeDefined();
    expect(none.events.find((e) => e.event === "decide")).toBeUndefined();
    expect(none.events.find((e) => e.event === "approvalDone")).toMatchObject({ allow: false, by: "timeout" });
  }, 90_000);
});
