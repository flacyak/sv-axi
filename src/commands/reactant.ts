import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { EXIT, emit, emitError } from "../output.js";
import { parseFlags, type FlagSpec } from "../flags.js";
import { discover, displayPath, emitAmbiguous, emitNoProject } from "../project.js";

export const REACTANT_FLAGS: FlagSpec[] = [
  { name: "cwd", takesValue: true },
  { name: "limit", takesValue: true, default: "200" },
];

export const REACTANT_HELP = `sv-axi reactant — map the project's components and how they react to change.

Lists every .svelte file in the project with its declared props and the change
types it uses (runes, stores, legacy reactivity), so an agent can pick the
right component to edit without opening each file. The project root is found
by searching up from the starting directory, then down through the repo.

Change types: props, state, derived, effect, bindable, store, context, legacy
("legacy" = pre-runes patterns: export let, $:, createEventDispatcher).

Usage:
  sv-axi reactant [--cwd <path>] [--limit <n>]

Flags:
  --cwd <path>    directory to start the search from (default: current directory)
  --limit <n>     max components to list (default: 200)
  --help          show this help

Examples:
  sv-axi reactant
  sv-axi reactant --cwd apps/web`;

interface ComponentRow {
  file: string;
  props: string;
  reacts: string;
}

/** Pull declared prop names from `let {…} = $props()` and `export let x`. */
function propNames(source: string): string[] {
  const names: string[] = [];

  const runes = source.match(/(?:let|const)\s*\{([^}]*)\}\s*=\s*\$props\(/);
  if (runes) {
    for (const part of runes[1].split(",")) {
      const name = part.trim().split(/[=:\s]/)[0];
      if (name) names.push(name);
    }
  }

  for (const m of source.matchAll(/^\s*export\s+let\s+([A-Za-z_$][\w$]*)/gm)) {
    names.push(m[1]);
  }
  return names;
}

const CHANGE_TYPES: Array<[name: string, pattern: RegExp]> = [
  ["props", /\$props\(|^\s*export\s+let\s/m],
  ["state", /\$state[(.]/],
  ["derived", /\$derived[(.]/],
  ["effect", /\$effect[(.]/],
  ["bindable", /\$bindable\(/],
  ["store", /from\s+["']svelte\/store["']/],
  ["context", /\b(getContext|setContext)\s*\(/],
  ["legacy", /^\s*export\s+let\s|^\s*\$:\s|createEventDispatcher/m],
];

export function analyzeComponent(source: string): { props: string[]; reacts: string[] } {
  const reacts = CHANGE_TYPES.filter(([, p]) => p.test(source)).map(([n]) => n);
  return { props: propNames(source), reacts };
}

async function walkSvelte(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkSvelte(full, out);
    else if (entry.name.endsWith(".svelte")) out.push(full);
  }
}

/** `sv-axi reactant` subcommand. */
export async function runReactant(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    emit({ help: REACTANT_HELP });
    return EXIT.OK;
  }

  const parsed = parseFlags(args, REACTANT_FLAGS);
  if (parsed.unknown) {
    return emitError(`unknown flag ${parsed.unknown} for \`reactant\``, {
      help: "valid flags for `reactant`: --cwd, --limit (--help always allowed)",
      code: EXIT.USAGE,
    });
  }
  if (parsed.error) {
    return emitError(parsed.error, { help: REACTANT_HELP, code: EXIT.USAGE });
  }

  const start = resolve((parsed.flags.cwd as string | undefined) ?? process.cwd());
  const found = await discover(start);
  if (!found.project) {
    return found.candidates.length > 1
      ? emitAmbiguous("reactant", found)
      : emitNoProject("reactant", found);
  }

  const project = found.project;
  const root = displayPath(project.root);

  const files: string[] = [];
  for (const dir of project.scanDirs) await walkSvelte(dir, files);

  if (files.length === 0) {
    emit({ root, components: "0 .svelte components found in this project" });
    return EXIT.OK;
  }

  const rows: ComponentRow[] = [];
  for (const f of files.sort()) {
    const { props, reacts } = analyzeComponent(await readFile(f, "utf8"));
    rows.push({
      file: relative(project.root, f).split(sep).join("/"),
      props: props.join("+"),
      reacts: reacts.join("+"),
    });
  }

  const limit = Number(parsed.flags.limit) || 200;
  const shown = rows.slice(0, limit);
  const payload: Record<string, unknown> = {
    root,
    count: `${shown.length} of ${rows.length} total`,
    components: shown,
  };
  const help: string[] = [];
  if (rows.length > shown.length) {
    help.push(`Run \`sv-axi reactant --limit ${rows.length}\` to list all components`);
  }
  help.push("Run `sv-axi check <file>` to flag outdated patterns in a component");
  payload.help = help;
  emit(payload);
  return EXIT.OK;
}
