import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { EXIT, emit, emitError } from "../output.js";
import { parseFlags, type FlagSpec } from "../flags.js";

export const ROUTES_FLAGS: FlagSpec[] = [
  { name: "cwd", takesValue: true },
  { name: "limit", takesValue: true, default: "200" },
];

export const ROUTES_HELP = `sv-axi routes — list the SvelteKit routes in a project.

Usage:
  sv-axi routes [--cwd <path>] [--limit <n>]

Flags:
  --cwd <path>    project root to scan (default: current directory)
  --limit <n>     max routes to list (default: 200)
  --help          show this help

Examples:
  sv-axi routes
  sv-axi routes --cwd ../my-app
  sv-axi routes --limit 500`;

export interface RouteRow {
  route: string;
  kind: string;
  file: string;
}

export interface RoutesResult {
  routesDir: string;
  rows: RouteRow[];
}

function kindOf(file: string): string {
  if (file.startsWith("+page")) return "page";
  if (file.startsWith("+layout")) return "layout";
  if (file.startsWith("+server")) return "endpoint";
  if (file.startsWith("+error")) return "error";
  return "other";
}

/** Derive the URL path for a route file, dropping SvelteKit `(group)` folders. */
function routePath(routesDir: string, file: string): string {
  const dir = relative(routesDir, file).split(sep).slice(0, -1).join("/");
  const clean = dir.replace(/\([^)]*\)\/?/g, "").replace(/\/+$/, "");
  return "/" + clean;
}

async function walk(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.startsWith("+")) out.push(full);
  }
}

/**
 * Scan `<cwd>/src/routes` and return every SvelteKit route file.
 * Returns `null` when the directory does not exist so callers can decide
 * how to report it (a hard error for the subcommand, a hint for the home view).
 */
export async function collectRoutes(cwd: string): Promise<RoutesResult | null> {
  const routesDir = join(cwd, "src", "routes");
  if (!existsSync(routesDir)) return null;

  const files: string[] = [];
  await walk(routesDir, files);

  const rows = files.sort().map((f): RouteRow => {
    const name = f.split(sep).pop()!;
    return { route: routePath(routesDir, f), kind: kindOf(name), file: name };
  });

  return { routesDir, rows };
}

/** `sv-axi routes` subcommand. */
export async function runRoutes(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    emit({ help: ROUTES_HELP });
    return EXIT.OK;
  }

  const parsed = parseFlags(args, ROUTES_FLAGS);
  if (parsed.unknown) {
    return emitError(`unknown flag ${parsed.unknown} for \`routes\``, {
      help: "valid flags for `routes`: --cwd, --limit (--help always allowed)",
      code: EXIT.USAGE,
    });
  }
  if (parsed.error) {
    return emitError(parsed.error, { help: ROUTES_HELP, code: EXIT.USAGE });
  }

  const cwd = (parsed.flags.cwd as string | undefined) ?? process.cwd();
  const result = await collectRoutes(cwd);
  if (!result) {
    return emitError(`no SvelteKit routes found (no ${join(cwd, "src", "routes")})`, {
      help: "run sv-axi from a SvelteKit project root, or pass --cwd <path>",
      code: EXIT.ERROR,
    });
  }

  if (result.rows.length === 0) {
    emit({ routes: "0 route files found under src/routes" });
    return EXIT.OK;
  }

  const limit = Number(parsed.flags.limit) || 200;
  const shown = result.rows.slice(0, limit);
  const payload: Record<string, unknown> = {
    count: `${shown.length} of ${result.rows.length} total`,
    routes: shown,
  };
  if (result.rows.length > shown.length) {
    payload.help = [`Run \`sv-axi routes --limit ${result.rows.length}\` to list all routes`];
  }
  emit(payload);
  return EXIT.OK;
}
