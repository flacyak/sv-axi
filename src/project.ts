import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { EXIT, emit, emitError } from "./output.js";

/**
 * Locating the project an agent is actually working in.
 *
 * Agents run commands from wherever the conversation left them — a nested
 * source directory, or the root of a monorepo whose app lives in `apps/web`.
 * Resolving `<cwd>/src/routes` literally reports "no project" in both cases,
 * which reads like a valid answer. So: search upward for the project root,
 * then downward for workspace members, and honour `kit.files` from
 * svelte.config.* rather than assuming the defaults.
 */

const CONFIG_NAMES = [
  "svelte.config.js",
  "svelte.config.mjs",
  "svelte.config.cjs",
  "svelte.config.ts",
];

/** Directories never worth descending into during the downward scan. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "static",
]);

const SCAN_MAX_DEPTH = 3;
const SCAN_MAX_DIRS = 4000;

export interface Project {
  /** Absolute path of the project root (the dir holding svelte.config.*). */
  root: string;
  /** Absolute routes dir — `kit.files.routes` when set, else `src/routes`. */
  routesDir: string;
  /** Absolute lib dir — `kit.files.lib` when set, else `src/lib`. */
  libDir: string;
  /** Dirs to scan for components: `src` plus any configured dir outside it. */
  scanDirs: string[];
  /** Absolute path of the svelte.config.* that was read, when one exists. */
  configFile?: string;
  /**
   * The config sets a `kit.files` path we could not resolve, so this project's
   * dirs are the defaults and may be wrong. Callers should say so rather than
   * report an empty result as fact.
   */
  configUnresolved?: boolean;
  /** e.g. "svelte ^5.0.0, kit ^2.0.0" — cheap aggregate for the home view. */
  versions?: string;
}

export interface Discovery {
  /** The single project to act on, when discovery is unambiguous. */
  project?: Project;
  /** Several SvelteKit projects found under one root — the agent must pick. */
  candidates: Project[];
  /** Dir the downward scan started from, for error messages. */
  searchedFrom: string;
}

function configFileIn(dir: string): string | undefined {
  for (const name of CONFIG_NAMES) {
    const full = join(dir, name);
    if (existsSync(full)) return full;
  }
  return undefined;
}

function readPackageJson(dir: string): Record<string, any> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function hasKitDep(dir: string): boolean {
  const pkg = readPackageJson(dir);
  if (!pkg) return false;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return Boolean(deps["@sveltejs/kit"] || deps.svelte);
}

/** Svelte/Kit versions from the project's package.json (AXI §4). */
export function projectVersions(root: string): string | undefined {
  const pkg = readPackageJson(root);
  if (!pkg) return undefined;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const parts: string[] = [];
  if (deps.svelte) parts.push(`svelte ${deps.svelte}`);
  if (deps["@sveltejs/kit"]) parts.push(`kit ${deps["@sveltejs/kit"]}`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Slice out the `{…}` that follows `files:`, by brace matching. */
function filesBlock(text: string): string | undefined {
  const key = /\bfiles\s*:\s*\{/.exec(text);
  if (!key) return undefined;
  let depth = 0;
  for (let i = key.index + key[0].length - 1; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(key.index, i);
  }
  return undefined;
}

function literalPath(block: string, key: string): string | undefined {
  const m = new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(block);
  return m?.[1];
}

interface KitFiles {
  routes?: string;
  lib?: string;
  /** A `kit.files` key is set to something we could neither read nor evaluate. */
  unresolved?: boolean;
}

const FILE_KEYS = ["routes", "lib"] as const;

/**
 * Is `key` present in the block at all — as `routes: …` or as the shorthand
 * `{ routes }`?
 *
 * The shorthand carries a path just as much as the long form does, so missing
 * it is worse than not parsing the block: the key looks absent, the default
 * path stands unchallenged, and `unresolved` never gets set — so a wrong
 * directory is reported as fact. The shorthand arm requires the name to open
 * the block or follow a comma, which keeps it from firing on a *value* of the
 * same name (`assets: routes`).
 */
function declares(block: string, key: string): boolean {
  return (
    new RegExp(`\\b${key}\\s*:`).test(block) ||
    new RegExp(`(?:^|[{,])\\s*${key}\\s*(?=[,}]|$)`).test(block)
  );
}

/** Evaluate the config to reach paths that text alone can't resolve. */
async function importedFiles(configFile: string): Promise<KitFiles> {
  try {
    const mod = await import(pathToFileURL(configFile).href);
    const files = (mod.default ?? mod)?.kit?.files;
    if (files && typeof files === "object") {
      return {
        routes: typeof files.routes === "string" ? files.routes : undefined,
        lib: typeof files.lib === "string" ? files.lib : undefined,
      };
    }
  } catch {
    // Unresolvable config (TS, missing adapter, side effects) — defaults hold.
  }
  return {};
}

/**
 * `kit.files.routes` / `kit.files.lib` from a config file.
 *
 * Read as text first: it covers configs that spell the paths out literally,
 * costs no module resolution, and doesn't execute the repo's code. Import only
 * when a key is set to something the text can't resolve — and note that a
 * partially literal block (`{ routes: dir, lib: 'src/components' }`) is exactly
 * that case, so the literals must account for *every* key that's present.
 */
async function configuredFiles(configFile: string): Promise<KitFiles> {
  let text: string;
  try {
    text = await readFile(configFile, "utf8");
  } catch {
    return {};
  }

  const block = filesBlock(text);
  if (!block) return {};

  const literal: KitFiles = {};
  const unresolved: Array<(typeof FILE_KEYS)[number]> = [];
  for (const key of FILE_KEYS) {
    if (!declares(block, key)) continue;
    const value = literalPath(block, key);
    if (value) literal[key] = value;
    else unresolved.push(key);
  }
  if (unresolved.length === 0) return literal;

  const evaluated = await importedFiles(configFile);
  const merged: KitFiles = {
    routes: evaluated.routes ?? literal.routes,
    lib: evaluated.lib ?? literal.lib,
  };
  if (unresolved.some((key) => merged[key] === undefined)) merged.unresolved = true;
  return merged;
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep);
}

/** `src`, plus any configured dir that sits outside it. Nested dirs dropped. */
function scanDirsFor(root: string, routesDir: string, libDir: string): string[] {
  const src = join(root, "src");
  const dirs = [src, routesDir, libDir].filter((d) => existsSync(d));
  return dirs.filter(
    (d, i) => dirs.indexOf(d) === i && !dirs.some((o) => o !== d && isInside(d, o)),
  );
}

/** Build a Project for `root`, resolving its config. */
async function toProject(root: string): Promise<Project> {
  const configFile = configFileIn(root);
  const files = configFile ? await configuredFiles(configFile) : {};
  const routesDir = resolve(root, files.routes ?? join("src", "routes"));
  const libDir = resolve(root, files.lib ?? join("src", "lib"));
  return {
    root,
    routesDir,
    libDir,
    scanDirs: scanDirsFor(root, routesDir, libDir),
    configFile,
    configUnresolved: files.unresolved,
    versions: projectVersions(root),
  };
}

/** A root only counts during the downward scan once its routes dir exists. */
async function strongProject(dir: string): Promise<Project | undefined> {
  if (!configFileIn(dir) && !hasKitDep(dir)) return undefined;
  const project = await toProject(dir);
  return existsSync(project.routesDir) ? project : undefined;
}

interface UpwardSearch {
  /** A root whose routes dir exists — unambiguously the project. */
  project?: Project;
  /** A root with a svelte.config.* but no routes dir yet (a fresh project). */
  configured?: Project;
  /** A root known only by a Svelte dependency — often just a hoisted dep. */
  dependency?: Project;
  gitRoot?: string;
}

/**
 * Walk up from `start` looking for the project root, stopping at a `.git`
 * boundary. A root with a routes dir wins outright. One without is held back:
 * a svelte.config.* still identifies a real project (with no routes written
 * yet), while a bare dependency is too weak to trust — in a monorepo it is
 * usually a hoisted `svelte` in the root package.json.
 */
async function searchUp(start: string): Promise<UpwardSearch> {
  let dir = start;
  const held: UpwardSearch = {};

  for (;;) {
    const config = configFileIn(dir);
    if (config || hasKitDep(dir)) {
      const project = await toProject(dir);
      if (existsSync(project.routesDir)) return { project };
      if (config) held.configured ??= project;
      else held.dependency ??= project;
    }

    if (existsSync(join(dir, ".git"))) return { ...held, gitRoot: dir };

    const parent = dirname(dir);
    if (parent === dir) return held;
    dir = parent;
  }
}

/** Bounded breadth-first scan for SvelteKit projects beneath `base`. */
async function searchDown(base: string): Promise<Project[]> {
  const found: Project[] = [];
  let queue: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < SCAN_MAX_DIRS) {
    const next: Array<{ dir: string; depth: number }> = [];

    for (const { dir, depth } of queue) {
      if (++visited > SCAN_MAX_DIRS) break;

      if (dir !== base) {
        const project = await strongProject(dir);
        if (project) {
          // A Kit project's own subdirs can't hold another one.
          found.push(project);
          continue;
        }
      }
      if (depth >= SCAN_MAX_DEPTH) continue;

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        next.push({ dir: join(dir, entry.name), depth: depth + 1 });
      }
    }
    queue = next;
  }

  return found.sort((a, b) => a.root.localeCompare(b.root));
}

/**
 * Find the SvelteKit project to act on, starting from `start`.
 *
 * Upward first (the agent is inside the project), then downward from the repo
 * root (the agent is above it, as in a monorepo). Several matches downward are
 * returned as `candidates` rather than guessed at.
 */
export async function discover(start: string): Promise<Discovery> {
  const from = resolve(start);
  const up = await searchUp(from);
  if (up.project) return { project: up.project, candidates: [], searchedFrom: from };

  // A svelte.config.* above us is definitive even with no routes dir: report
  // that project as empty rather than scanning off and answering about a
  // sibling app, which would look like a valid answer for the wrong project.
  if (up.configured) return { project: up.configured, candidates: [], searchedFrom: from };

  const base = up.gitRoot ?? from;
  const down = await searchDown(base);
  if (down.length === 1) return { project: down[0], candidates: down, searchedFrom: base };
  if (down.length > 1) return { candidates: down, searchedFrom: base };

  if (up.dependency) return { project: up.dependency, candidates: [], searchedFrom: from };
  return { candidates: [], searchedFrom: base };
}

/** Path of `target` relative to `from`, for output the agent can paste back. */
export function displayPath(target: string, from: string = process.cwd()): string {
  const rel = relative(from, target);
  if (rel === "") return ".";
  return rel.startsWith("..") ? target : rel;
}

/** One row per discovered project, for ambiguous results. */
export function candidateRows(candidates: Project[]): Array<Record<string, string>> {
  return candidates.map((c) => ({
    path: displayPath(c.root),
    versions: c.versions ?? "",
  }));
}

/**
 * Discovery found several projects: the agent must name one (AXI §6 — fail
 * loud, and inline what it needs to self-correct in a single turn).
 */
export function emitAmbiguous(command: string, d: Discovery): number {
  emit({
    error: `${d.candidates.length} SvelteKit projects found under ${displayPath(d.searchedFrom)} — pass --cwd to pick one`,
    projects: candidateRows(d.candidates),
    help: `Run \`sv-axi ${command} --cwd ${displayPath(d.candidates[0].root)}\``,
  });
  return EXIT.USAGE;
}

/** Discovery found nothing: say where it looked (AXI §5, §9). */
export function emitNoProject(command: string, d: Discovery): number {
  return emitError(
    `no SvelteKit project found in or under ${displayPath(d.searchedFrom)}`,
    {
      help: [
        `Run \`sv-axi ${command} --cwd <path>\` to point at a project root`,
        "A project root is the directory holding svelte.config.js",
      ],
      code: EXIT.ERROR,
    },
  );
}
