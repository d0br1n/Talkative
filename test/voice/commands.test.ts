import { describe, expect, test } from "bun:test";
import { matchCommand } from "../../src/voice/commands.js";

describe("matchCommand", () => {
  test("matches the whole normalised utterance", () => {
    expect(matchCommand("Stop.")).toBe("stop");
    expect(matchCommand("New conversation!")).toBe("new conversation");
    expect(matchCommand("  AUDIO,  off ")).toBe("audio off");
    expect(matchCommand("audio-on")).toBe("audio on");
    expect(matchCommand("Continue")).toBe("continue");
  });
  test("anything longer or different is not a command", () => {
    expect(matchCommand("stop the build")).toBeNull();
    expect(matchCommand("please stop")).toBeNull();
    expect(matchCommand("")).toBeNull();
    expect(matchCommand("...")).toBeNull();
  });
});
