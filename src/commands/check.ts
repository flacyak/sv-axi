import { readFile, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { EXIT, emit, emitError } from "../output.js";
import { parseFlags, type FlagSpec } from "../flags.js";
import { discover, displayPath, emitAmbiguous, emitNoProject } from "../project.js";

export const CHECK_FLAGS: FlagSpec[] = [
  { name: "cwd", takesValue: true },
  { name: "limit", takesValue: true, default: "200" },
];

export const CHECK_HELP = `sv-axi check — static checks for outdated or risky Svelte patterns.

Flags issues in .svelte files with the modern (Svelte 5) fix for each.
Exit code is 0 even when issues are found — re-run after fixing until clean.

Usage:
  sv-axi check [files...] [--cwd <path>] [--limit <n>]

With no files, the project is found by searching up from the starting
directory, then down through the repo, and every .svelte file in it is checked.

Flags:
  --cwd <path>    directory to start from; also resolves the file arguments
                  (default: current directory)
  --limit <n>     max issues to list (default: 200)
  --help          show this help

Examples:
  sv-axi check
  sv-axi check src/lib/Button.svelte
  sv-axi check --cwd apps/web`;

interface Issue {
  file: string;
  line: number;
  rule: string;
  fix: string;
}

interface Rule {
  name: string;
  pattern: RegExp;
  fix: string;
}

const RULES: Rule[] = [
  { name: "export-let", pattern: /^\s*export\s+let\s/, fix: "declare props with `let { … } = $props()`" },
  { name: "reactive-label", pattern: /^\s*\$:\s/, fix: "use `$derived(…)` for values, `$effect(() => …)` for side effects" },
  { name: "on-directive", pattern: /\son:[a-zA-Z]+[=\s>{]/, fix: "use event attributes: `onclick={…}` instead of `on:click`" },
  { name: "event-dispatcher", pattern: /createEventDispatcher/, fix: "replace dispatched events with callback props" },
  { name: "lifecycle-update", pattern: /\b(beforeUpdate|afterUpdate)\b/, fix: "use `$effect.pre` / `$effect` instead" },
  { name: "slot-element", pattern: /<slot[\s/>]/, fix: "use snippets: `{@render children?.()}` instead of `<slot>`" },
  { name: "dollar-props", pattern: /\$\$(props|restProps)\b/, fix: "use `let { …, ...rest } = $props()`" },
  { name: "svelte-component", pattern: /<svelte:component\s/, fix: "render the component variable directly: `<Thing />` works with dynamic values in Svelte 5" },
  { name: "unkeyed-each", pattern: /\{#each\s+(?![^}]*\([^)]*\)\s*\})[^}]*\}/, fix: "add a key: `{#each items as item (item.id)}`" },
];

async function walkSvelte(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkSvelte(full, out);
    else if (entry.name.endsWith(".svelte")) out.push(full);
  }
}

export async function checkFile(path: string, cwd: string): Promise<Issue[]> {
  const text = await readFile(path, "utf8");
  const lines = text.split("\n");
  const issues: Issue[] = [];
  const file = relative(cwd, path) || path;

  for (let i = 0; i < lines.length; i++) {
    for (const rule of RULES) {
      if (rule.pattern.test(lines[i])) {
        issues.push({ file, line: i + 1, rule: rule.name, fix: rule.fix });
      }
    }
  }
  return issues;
}

/** `sv-axi check` subcommand. */
export async function runCheck(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    emit({ help: CHECK_HELP });
    return EXIT.OK;
  }

  const parsed = parseFlags(args, CHECK_FLAGS);
  if (parsed.unknown) {
    return emitError(`unknown flag ${parsed.unknown} for \`check\``, {
      help: "valid flags for `check`: --cwd, --limit (--help always allowed)",
      code: EXIT.USAGE,
    });
  }
  if (parsed.error) {
    return emitError(parsed.error, { help: CHECK_HELP, code: EXIT.USAGE });
  }

  const start = resolve((parsed.flags.cwd as string | undefined) ?? process.cwd());
  let files = parsed.positionals;
  let base = start;
  let root: string | undefined;

  if (files.length === 0) {
    const found = await discover(start);
    if (!found.project) {
      return found.candidates.length > 1
        ? emitAmbiguous("check", found)
        : emitNoProject("check", found);
    }
    base = found.project.root;
    root = displayPath(base);
    files = [];
    for (const dir of found.project.scanDirs) await walkSvelte(dir, files);
  } else {
    // Explicit paths are the agent's own, resolved against --cwd when given.
    files = files.map((f) => resolve(start, f));
    for (const f of files) {
      if (!existsSync(f) || !statSync(f).isFile()) {
        return emitError(`no such file: ${displayPath(f)}`, {
          help: "Run `sv-axi reactant` to list the project's components",
          code: EXIT.ERROR,
        });
      }
    }
  }

  const issues: Issue[] = [];
  for (const f of files) issues.push(...(await checkFile(f, base)));

  if (issues.length === 0) {
    const payload: Record<string, unknown> = {};
    if (root) payload.root = root;
    payload.check = `0 issues found in ${files.length} .svelte file${files.length === 1 ? "" : "s"}`;
    emit(payload);
    return EXIT.OK;
  }

  const limit = Number(parsed.flags.limit) || 200;
  const shown = issues.slice(0, limit);
  const payload: Record<string, unknown> = {
    ...(root ? { root } : {}),
    count: `${shown.length} of ${issues.length} total`,
    issues: shown,
    help: [
      "Fix the issues, then re-run `sv-axi check` until it reports 0",
      "Run `sv-axi docs svelte/v5-migration-guide` for the full migration reference",
    ],
  };
  emit(payload);
  return EXIT.OK;
}
