/** The value after `--name`; undefined if the flag is absent. A missing value, or one that looks like a flag, is a usage error. */
export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v === "" || v.startsWith("--")) throw new UsageError(`--${name} needs a value`);
  return v;
}

export class UsageError extends Error {}
