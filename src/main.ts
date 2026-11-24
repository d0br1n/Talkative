#!/usr/bin/env bun
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homeDir, initConfig, loadConfig } from "./config";

const USAGE = "usage: bun src/main.ts <init --bind <ip> --project <dir> | livekit | voice | agent | code>";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "init": {
      const bind = flag(rest, "bind");
      const project = flag(rest, "project");
      if (!bind || !project) return fail(USAGE);
      initConfig({ bind, project });
      console.log(`wrote ${join(homeDir(), "config.json")} (bind ${bind}, project ${project})`);
      return 0;
    }
    case "livekit": {
      const { writeLivekitConfig } = await import("./voice/livekit");
      const { path, dockerCommand } = writeLivekitConfig(loadConfig().voice.bind);
      console.log(`wrote ${path}\n\n${dockerCommand}`);
      return 0;
    }
    case "voice": {
      const { runVoice } = await import("./voice/service");
      await runVoice(loadConfig());
      return 0;
    }
    case "agent": {
      const { runAgent } = await import("./agent/service");
      await runAgent(loadConfig());
      return 0;
    }
    case "code": {
      const p = join(homeDir(), "code");
      if (!existsSync(p)) return fail("no pairing code: is `voice` running?");
      chmodSync(p, 0o600);
      process.stdout.write(readFileSync(p, "utf8"));
      return 0;
    }
    default:
      return fail(USAGE);
  }
}

function fail(msg: string): number {
  console.error(msg);
  return 2;
}

try {
  process.exit(await main());
} catch (e) {
  console.error(`talkative: ${(e as Error).message}`);
  process.exit(1);
}
