import { expect, test } from "bun:test";
import { AgentPhase } from "../../src/voice/agent-phase.js";
import { LINES } from "../../src/voice/lines.js";

test("two asked restarts in one window do not silence a later crash restart", () => {
  const p = new AgentPhase();
  p.linkUp("first");
  p.update("ready");
  p.askedRestart();
  expect(p.update("restarting").line).toBeNull();
  p.askedRestart();
  expect(p.update("restarting").line).toBeNull();
  p.update("ready");
  expect(p.update("restarting").line).toBe(LINES.restarting);
});
