import { realpathSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EXIT, emit, emitError } from "./output.js";
import { collectRoutes, runRoutes } from "./commands/routes.js";
import { runReactant } from "./commands/reactant.js";
import { runDocs } from "./commands/docs.js";
import { runCheck } from "./commands/check.js";

const DESCRIPTION =
  "Inspect a SvelteKit project and fetch official Svelte docs, for agents driving the shell.";

interface Command {
  name: string;
  summary: string;
  run(args: string[]): Promise<number>;
}

const COMMANDS: Command[] = [
  { name: "routes", summary: "List the SvelteKit routes in the project", run: runRoutes },
  { name: "reactant", summary: "Map components: props and change types (runes, stores, legacy)", run: runReactant },
  { name: "check", summary: "Flag outdated Svelte patterns with the modern fix for each", run: runCheck },
  { name: "docs", summary: "List and fetch official Svelte/SvelteKit docs sections", run: runDocs },
];

/** Absolute path of the current executable, home collapsed to `~` (AXI §10). */
function binPath(): string {
  const raw = process.argv[1];
  if (!raw) return "sv-axi";
  let resolved: string;
  try {
    resolved = realpathSync(raw);
  } catch {
    resolved = raw;
  }
  const home = homedir();
  return resolved.startsWith(home) ? "~" + resolved.slice(home.length) : resolved;
}

/** Svelte/Kit versions from the project's package.json — cheap aggregate (AXI §4). */
function projectVersions(cwd: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const parts: string[] = [];
    if (deps.svelte) parts.push(`svelte ${deps.svelte}`);
    if (deps["@sveltejs/kit"]) parts.push(`kit ${deps["@sveltejs/kit"]}`);
    return parts.length > 0 ? parts.join(", ") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * No-args home view: identify the tool, then show live content the agent can
 * act on immediately (AXI §8, §10). Falls back to guidance when the current
 * directory is not a SvelteKit project.
 */
async function home(): Promise<number> {
  const cwd = process.cwd();
  const result = await collectRoutes(cwd);

  if (!result) {
    emit({
      bin: binPath(),
      description: DESCRIPTION,
      routes: "no SvelteKit project detected in the current directory",
      help: [
        "cd into a SvelteKit project root, or run `sv-axi routes --cwd <path>`",
        "Run `sv-axi docs` to browse official Svelte/SvelteKit docs",
        "Run `sv-axi --help` to see all commands",
      ],
    });
    return EXIT.OK;
  }

  const shown = result.rows.slice(0, 200);
  const payload: Record<string, unknown> = {
    bin: binPath(),
    description: DESCRIPTION,
  };
  const versions = projectVersions(cwd);
  if (versions) payload.versions = versions;
  payload.count = `${shown.length} of ${result.rows.length} total`;
  payload.routes = shown.length > 0 ? shown : "0 route files found under src/routes";

  const help: string[] = [];
  if (result.rows.length > shown.length) {
    help.push(`Run \`sv-axi routes --limit ${result.rows.length}\` to list all routes`);
  }
  help.push("Run `sv-axi reactant` to map components and their change types");
  help.push("Run `sv-axi check` to flag outdated Svelte patterns");
  help.push("Run `sv-axi docs <slug>` for official docs, e.g. `sv-axi docs kit/load`");
  payload.help = help;
  emit(payload);
  return EXIT.OK;
}

/** Concise top-level reference (AXI §10). */
function topHelp(): number {
  const lines = [
    `bin: ${binPath()}`,
    `description: ${DESCRIPTION}`,
    "",
    "Usage: sv-axi [command] [flags]",
    "",
    "Commands:",
    ...COMMANDS.map((c) => `  ${c.name.padEnd(10)} ${c.summary}`),
    "",
    "Run with no command to see the current project's routes.",
    "Run `sv-axi <command> --help` for command details.",
  ];
  emit({ help: lines.join("\n") });
  return EXIT.OK;
}

export async function run(argv: string[]): Promise<number> {
  const first = argv[0];

  if (first === undefined) return home();
  if (first === "--help" || first === "-h") return topHelp();

  const command = COMMANDS.find((c) => c.name === first);
  if (command) return command.run(argv.slice(1));

  if (first.startsWith("-")) {
    return emitError(`unknown flag ${first}`, {
      help: "run `sv-axi --help` for usage, or `sv-axi` to see the current project's routes",
      code: EXIT.USAGE,
    });
  }

  return emitError(`unknown command \`${first}\``, {
    help: `valid commands: ${COMMANDS.map((c) => c.name).join(", ")} (run \`sv-axi --help\`)`,
    code: EXIT.USAGE,
  });
}
