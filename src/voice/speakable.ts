const NOTE = "It's on your screen.";

/**
 * A path has a path shape: a leading `/`, `./`, `../` or `~/`, or two or more
 * `/`-separated segments whose last has a file extension. "and/or" is not one.
 */
function isPath(token: string): boolean {
  const t = token.replace(/[.,;:!?)\]]+$/, "");
  if (/^(\/|\.\/|\.\.\/|~\/)/.test(t)) return true;
  const parts = t.split("/");
  return parts.length >= 2 && parts.every(Boolean) && /\.[A-Za-z0-9]{1,8}$/.test(parts[parts.length - 1]!);
}

/** A token that is part of a path or a command: a path, a backslash or backtick, or a `--flag`. */
function isCodeToken(token: string): boolean {
  return isPath(token) || /[\\`]/.test(token) || token.startsWith("--");
}

/** At least 60% of the non-space characters sit in backtick spans or path/command tokens. */
function mostlyPathOrCommand(line: string): boolean {
  let code = 0;
  const rest = line.replace(/`[^`]*`?/g, (span) => {
    code += span.replace(/\s/g, "").length;
    return " ";
  });
  const tokens = rest.split(/\s+/).filter(Boolean);
  for (const t of tokens) if (isCodeToken(t)) code += t.length;
  const total = code + tokens.filter((t) => !isCodeToken(t)).reduce((n, t) => n + t.length, 0);
  return total > 0 && code / total >= 0.6;
}

const isSeparator = (line: string) => /^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const isTableRow = (line: string) => /^\s*\|/.test(line) || isSeparator(line);

/**
 * The text of a block as the voice may say it. Fenced code, tables, and lines
 * that are mostly a path or a command are removed; each removed run leaves one
 * "It's on your screen." and nothing more.
 */
export function speakable(blockText: string): { speak: string; removed: number } {
  const out: string[] = [];
  let removed = 0;
  let inFence = false;
  let inRun = false;
  let inTable = false;
  const drop = () => {
    if (!inRun) { out.push(NOTE); removed++; inRun = true; }
  };
  const lines = blockText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // a pipe-less header row is a table row when a separator row follows it
    const header = line.includes("|") && isSeparator(lines[i + 1] ?? "");
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      inTable = false;
      drop();
      continue;
    }
    inTable = header || isTableRow(line) || (inTable && line.includes("|"));
    if (inFence || inTable || mostlyPathOrCommand(line)) { drop(); continue; }
    // blank lines do not end a removed run
    if (line.trim() === "") continue;
    inRun = false;
    out.push(line.trim());
  }
  return { speak: out.join(" ").replace(/\s+/g, " ").trim(), removed };
}
