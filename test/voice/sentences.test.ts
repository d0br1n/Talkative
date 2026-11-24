import { describe, expect, test } from "bun:test";
import { SentenceCollector } from "../../src/voice/sentences.js";

describe("SentenceCollector", () => {
  test("a sentence is ready as soon as its end is certain", () => {
    const c = new SentenceCollector();
    expect(c.push("The bridge is ready")).toEqual([]);
    expect(c.push(".")).toEqual([]);
    expect(c.push(" And")).toEqual(["The bridge is ready."]);
  });
  test("a decimal is not the end of a sentence", () => {
    expect(new SentenceCollector().push("it costs 3.5 cents. ")).toEqual(["it costs 3.5 cents."]);
  });
  test("a newline ends a sentence, for a list", () => {
    expect(new SentenceCollector().push("the first item\nthe second item\n")).toEqual(["the first item", "the second item"]);
  });
  test("a closing quote stays with its sentence", () => {
    expect(new SentenceCollector().push('he said "go." then he left. ')).toEqual(['he said "go."', "then he left."]);
  });
  test("a full stop inside a quotation does not end the sentence", () => {
    const c = new SentenceCollector();
    expect(c.push('Then it says "That is the card. Listening." And')).toEqual(['Then it says "That is the card. Listening."']);
    expect(c.push(' it says "Done." Then')).toEqual(['And it says "Done."']);
  });
  test("a sentence of one or two words joins the next one", () => {
    const c = new SentenceCollector();
    expect(c.push("Added. It's item 70. Round 1. ")).toEqual(["Added. It's item 70."]);
    expect(c.push("Stats here, now.\nYes.")).toEqual(["Round 1. Stats here, now."]);
    expect(c.flush()).toEqual(["Yes."]);
  });
  test("a long run with no punctuation is broken at a space", () => {
    expect(new SentenceCollector(20).push("aaaa bbbb cccc dddd eeee ffff")).toEqual(["aaaa bbbb cccc dddd"]);
  });
  test("the tail of a reply is a sentence even without punctuation", () => {
    const c = new SentenceCollector();
    c.push("no full stop here");
    expect(c.flush()).toEqual(["no full stop here"]);
    expect(c.flush()).toEqual([]);
  });
  test("a trailing full stop waits, and flush gives it back", () => {
    const c = new SentenceCollector();
    expect(c.push("I'll check the worktrees.")).toEqual([]);
    expect(c.flush()).toEqual(["I'll check the worktrees."]);
  });
  test("a number or an ellipsis split across pushes is not split", () => {
    const c = new SentenceCollector();
    expect(c.push("it costs 3.")).toEqual([]);
    expect(c.push("5 cents. ")).toEqual(["it costs 3.5 cents."]);
    expect(c.push("well, it is.")).toEqual([]);
    expect(c.push("..")).toEqual([]);
    expect(c.push(" maybe it is. ")).toEqual(["well, it is...", "maybe it is."]);
  });
});

import { speakable } from "../../src/voice/speakable.js";

describe("SentenceCollector with fences, tables and abbreviations", () => {
  test("a fenced block split across deltas is one unit", () => {
    const c = new SentenceCollector();
    const units = [
      ...c.push("Done.\n```ts\n"), ...c.push("x()\n"), ...c.push("```\nAll good."), ...c.flush(),
    ];
    expect(units.map((u) => speakable(u).speak)).toEqual(["Done.", "It's on your screen.", "All good."]);
  });
  test("a fence marker split across deltas still works", () => {
    const c = new SentenceCollector();
    const units = [...c.push("Look.\n`"), ...c.push("``\nfoo. bar.\n``"), ...c.push("`\nOk then."), ...c.flush()];
    expect(units.map((u) => speakable(u).speak)).toEqual(["Look.", "It's on your screen.", "Ok then."]);
  });
  test("an unclosed fence comes out at flush", () => {
    const c = new SentenceCollector(10);
    expect(c.push("```\nsome code that is long enough to pass the limit\n")).toEqual([]);
    expect(c.flush().map((u) => speakable(u).speak)).toEqual(["It's on your screen."]);
  });
  test("a table split across deltas is one unit", () => {
    const c = new SentenceCollector();
    const units = [...c.push("| a | b |\n|---"), ...c.push("|---|\n| 1 | 2 |\n"), ...c.push("Next up here.\n"), ...c.flush()];
    expect(units.map((u) => speakable(u).speak)).toEqual(["It's on your screen.", "Next up here."]);
    expect(units[0]!.split("\n")).toHaveLength(3);
  });
  test("no cut after an abbreviation", () => {
    const a = new SentenceCollector();
    expect([...a.push("Use e.g. a fast model. Then stop."), ...a.flush()]).toEqual(["Use e.g. a fast model.", "Then stop."]);
    const b = new SentenceCollector();
    expect([...b.push("That is i.e. the same. Done."), ...b.flush()]).toEqual(["That is i.e. the same.", "Done."]);
    const d = new SentenceCollector();
    expect([...d.push("Ask Dr. Smith about it now. Thanks."), ...d.flush()]).toEqual(["Ask Dr. Smith about it now.", "Thanks."]);
  });
});
