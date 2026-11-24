// Tiny table-driven validator shared by the link and phone codecs.
// A field spec maps a field name to its kind; a trailing "?" on the name marks it optional.
export type Kind = "string" | "number" | "boolean" | readonly string[];
export type FieldSpec = Record<string, Kind>;

function matches(value: unknown, kind: Kind): boolean {
  if (typeof kind === "string") return typeof value === kind;
  return typeof value === "string" && kind.includes(value);
}

/** Parse JSON and check it against the per-`t` spec table. Returns the object or throws via `fail`. */
export function parseMessage<T>(
  raw: string,
  table: Record<string, FieldSpec>,
  fail: (msg: string) => never,
): T {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return fail("malformed JSON");
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return fail("message is not an object");
  const rec = obj as Record<string, unknown>;
  const spec = typeof rec.t === "string" && Object.hasOwn(table, rec.t) ? table[rec.t] : undefined;
  if (!spec) return fail(`unknown message type: ${String(rec.t)}`);
  for (const [key, kind] of Object.entries(spec)) {
    const optional = key.endsWith("?");
    const name = optional ? key.slice(0, -1) : key;
    const value = rec[name];
    if (value === undefined) {
      if (!optional) return fail(`${rec.t}: missing field ${name}`);
    } else if (!matches(value, kind)) {
      return fail(`${rec.t}: bad field ${name}`);
    }
  }
  return rec as T;
}
