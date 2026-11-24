import { describe, expect, test } from "bun:test";
import { speakable } from "../../src/voice/speakable.js";

const NOTE = "It's on your screen.";

describe("speakable", () => {
  test("plain prose is untouched", () => {
    expect(speakable("All good here.")).toEqual({ speak: "All good here.", removed: 0 });
  });
  test("a fenced code block is replaced once", () => {
    expect(speakable("Done.\n```ts\nx()\n```\nAll good.")).toEqual({ speak: `Done. ${NOTE} All good.`, removed: 1 });
  });
  test("an unclosed fence removes the rest", () => {
    expect(speakable("Look:\n```\nfoo\nbar")).toEqual({ speak: `Look: ${NOTE}`, removed: 1 });
  });
  test("a table-only block", () => {
    expect(speakable("| a | b |\n|---|---|\n| 1 | 2 |")).toEqual({ speak: NOTE, removed: 1 });
  });
  test("a table with a pipe-less separator row", () => {
    expect(speakable("a | b\n--- | ---\n1 | 2")).toEqual({ speak: NOTE, removed: 1 });
  });
  test("a path line and a command line are removed", () => {
    expect(speakable("Edited:\nsrc/voice/ear.ts\ngit commit --amend --no-edit")).toEqual({ speak: `Edited: ${NOTE}`, removed: 1 });
    expect(speakable("Run this\n`bun run typecheck --noEmit`\nThen rest.")).toEqual({ speak: `Run this ${NOTE} Then rest.`, removed: 1 });
  });
  test("a sentence that merely mentions a path is kept", () => {
    const text = "I changed the sentence collector in src/x.ts to split on newlines more eagerly.";
    expect(speakable(text)).toEqual({ speak: text, removed: 0 });
  });
  test("separate runs each get one note; blank lines do not split a run", () => {
    expect(speakable("```\na\n```\n\n```\nb\n```\nOk.\n```\nc\n```")).toEqual({ speak: `${NOTE} Ok. ${NOTE}`, removed: 2 });
  });
  test("and/or and yes/no are not paths", () => {
    const text = "Use and/or here, yes/no.";
    expect(speakable(text)).toEqual({ speak: text, removed: 0 });
  });
  test("real paths are still removed", () => {
    expect(speakable("see src/voice/ear.ts and ./run.sh")).toEqual({ speak: NOTE, removed: 1 });
    expect(speakable("~/notes/todo.md")).toEqual({ speak: NOTE, removed: 1 });
  });
  test("table state does not carry out of a fence", () => {
    expect(speakable("```\n| not a table |\n```\nplain a | b text stays")).toEqual({ speak: `${NOTE} plain a | b text stays`, removed: 1 });
  });
});
