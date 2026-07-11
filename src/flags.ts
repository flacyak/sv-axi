/** Declares a flag a command accepts. Unknown flags are rejected (AXI §6). */
export interface FlagSpec {
  name: string;
  takesValue: boolean;
  default?: string | boolean;
}

export interface ParseResult {
  flags: Record<string, string | boolean>;
  positionals: string[];
  /** Set when an unrecognized flag was seen, e.g. "--stat". */
  unknown?: string;
  /** Set when a known flag was given without its required value. */
  error?: string;
}

/**
 * Parse argv against a command's known flag set. Supports `--flag value`,
 * `--flag=value`, and boolean `--flag`. Any flag not in `specs` is reported
 * back via `unknown` rather than silently dropped (AXI §6: fail loud).
 * `--help`/`-h` are handled by the caller before parsing.
 */
export function parseFlags(args: string[], specs: FlagSpec[]): ParseResult {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (const s of specs) {
    if (s.default !== undefined) flags[s.name] = s.default;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const spec = byName.get(name);
      if (!spec) return { flags, positionals, unknown: `--${name}` };

      if (spec.takesValue) {
        let value: string;
        if (eq !== -1) {
          value = arg.slice(eq + 1);
        } else {
          const next = args[++i];
          if (next === undefined) {
            return { flags, positionals, error: `flag --${name} requires a value` };
          }
          value = next;
        }
        flags[name] = value;
      } else {
        flags[name] = true;
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      return { flags, positionals, unknown: arg };
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}
