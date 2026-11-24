#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flag, UsageError } from "./cli";
import { codePath, homeDir, initConfig, loadConfig } from "./config";

const USAGE = "usage: bun src/main.ts <init --bind <ip> --project <dir> [--force] | livekit | voice | agent | code>";

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "init": {
      const bind = flag(rest, "bind");
      const project = flag(rest, "project");
      if (!bind || !project) return fail(USAGE);
      const abs = resolve(project);
      initConfig({ bind, project: abs, force: rest.includes("--force") });
      console.log(`wrote ${resolve(homeDir(), "config.json")} (bind ${bind}, project ${abs})`);
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
      return await runVoice(loadConfig());
    }
    case "agent": {
      const { runAgent } = await import("./agent/service");
      return await runAgent(loadConfig());
    }
    case "code": {
      let code = "";
      try {
        code = readFileSync(codePath(), "utf8").trim();
      } catch {}
      if (!code) return fail("no pairing code: is `voice` running?");
      console.log(code);
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
  process.exit(e instanceof UsageError ? 2 : 1);
}
