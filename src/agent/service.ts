import type { Config } from "../config";
import { runService } from "../lifecycle";
import { spawnClaude } from "./claude";
import { Coordinator } from "./coordinator";
import { connectAgent, LinkClient } from "./link-client";

/** Run the agent host until a signal: coordinator, link client, and the wiring between them. Resolves to the exit code. */
export function runAgent(config: Config): Promise<number> {
  return runService(async (cleanup) => {
    const a = config.agent;
    const timeout = process.env.TALKATIVE_APPROVAL_TIMEOUT_MS;
    const approvalTimeoutMs = timeout !== undefined && /^\d+$/.test(timeout) ? Number(timeout) : undefined;
    let client: LinkClient;
    const coordinator = new Coordinator({
      spawn: spawnClaude, cwd: a.project, model: a.model, effort: a.effort,
      emit: (m) => client.send(m), approvalTimeoutMs,
    });
    cleanup.add("coordinator", () => coordinator.stop());
    client = new LinkClient({
      url: a.voiceUrl, secret: config.linkSecret, onMessage: () => {},
      onState: (s) => console.log(`agent: link ${s}`),
    });
    cleanup.add("link client", () => client.stop());
    connectAgent(coordinator, client);
    coordinator.start();
    client.start();
    console.log(`agent: started in ${a.project}, dialling ${a.voiceUrl}`);
  });
}
