// Writes the golden frames the Swift MarkRenderer tests compare against.
// site/mark.js is an IIFE, so the frame() source is extracted and evaluated.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../site/mark.js', import.meta.url), 'utf8');
const start = src.indexOf('function frame(t)');
const end = src.indexOf('// The listening animation');
if (start < 0 || end < 0) throw new Error('frame(t) not found in site/mark.js');
const body = src.slice(start, end).trimEnd();
const frame = new Function(`${body}\nreturn frame;`)() as (t: number) => string;

const times = [0, 1, 7, 12, 40, 41.5, 300];
const out = times.map((t) => ({ t, frame: frame(t) }));
const path = new URL(
  '../ios/TalkativeCore/Tests/TalkativeCoreTests/Fixtures/mark-frames.json',
  import.meta.url,
);
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${out.length} frames`);
