import { encode } from "@toon-format/toon";

/**
 * Exit codes (AXI §6):
 *   0 = success, including no-ops
 *   1 = runtime error
 *   2 = usage error (missing/unknown flag or command)
 */
export const EXIT = { OK: 0, ERROR: 1, USAGE: 2 } as const;

/**
 * Render a JSON-shaped value as TOON and write it to stdout.
 * TOON conversion happens only here, at the output boundary — internal
 * logic stays on plain objects (AXI §1).
 */
export function emit(value: unknown): void {
  process.stdout.write(encode(value) + "\n");
}

/** Progress/diagnostics go to stderr so agents never parse them as data (AXI §6). */
export function debug(message: string): void {
  process.stderr.write(message + "\n");
}

/**
 * Emit a structured error on stdout (AXI §6) and return an exit code.
 * `help` may be a single suggestion or several; it is always actionable.
 */
export function emitError(
  message: string,
  opts: { help?: string | string[]; code?: number } = {},
): number {
  const payload: Record<string, unknown> = { error: message };
  if (opts.help !== undefined) payload.help = opts.help;
  emit(payload);
  return opts.code ?? EXIT.ERROR;
}
