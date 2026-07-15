import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { EXIT, emit, emitError } from "../output.js";
import { parseFlags, type FlagSpec } from "../flags.js";

export const SETUP_FLAGS: FlagSpec[] = [
  { name: "app", takesValue: true, default: "all" },
  { name: "scope", takesValue: true, default: "project" },
  { name: "cwd", takesValue: true },
];

export const SETUP_HELP = `sv-axi setup — register session-start hooks so agents see project context automatically.

Installs a SessionStart hook (Claude Code, Codex) or a managed plugin (OpenCode)
that runs \`sv-axi --session\`, injecting the project's routes as ambient context
at the start of every agent session. Idempotent: re-running repairs the executable
path if it moved and no-ops otherwise.

Usage:
  sv-axi setup [--app <name>] [--scope <project|user>] [--cwd <path>]

Flags:
  --app <name>      claude, codex, opencode, or all (default: all — apps whose
                    config directory is missing are skipped; name one explicitly
                    to install for it anyway)
  --scope <scope>   project (default) writes into the project's config dir;
                    user writes into the per-user config dir
  --cwd <path>      project root for --scope project (default: current directory)
  --help            show this help

Examples:
  sv-axi setup
  sv-axi setup --app claude
  sv-axi setup --scope user`;

const APPS = ["claude", "codex", "opencode"] as const;
type App = (typeof APPS)[number];

type Scope = "project" | "user";

/** One line of the setup report: what happened for one app. */
interface SetupRow {
  app: string;
  status: string;
  target: string;
}

/** The resolved hook invocation, in both shell-string and argv form. */
interface HookCommand {
  /** Shell command string embedded in JSON hook files. */
  shell: string;
  /** argv form embedded in the generated OpenCode plugin. */
  bin: string;
  args: string[];
}

function tilde(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? "~" + path.slice(home.length) : path;
}

function quoteIfNeeded(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/**
 * Command the hooks will run (AXI §7 portable commands): the bare binary name
 * when `sv-axi` on PATH resolves to this executable, otherwise the absolute
 * path so hooks never accidentally run a different binary.
 */
function hookCommand(): HookCommand {
  let script: string | undefined = process.argv[1];
  try {
    if (script) script = realpathSync(script);
  } catch {
    // keep the unresolved path
  }
  if (script) {
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      if (!dir) continue;
      try {
        if (realpathSync(join(dir, "sv-axi")) === script) {
          return { shell: "sv-axi --session", bin: "sv-axi", args: ["--session"] };
        }
      } catch {
        // candidate missing — keep scanning
      }
    }
    return {
      shell: `${quoteIfNeeded(process.execPath)} ${quoteIfNeeded(script)} --session`,
      bin: process.execPath,
      args: [script, "--session"],
    };
  }
  return { shell: "sv-axi --session", bin: "sv-axi", args: ["--session"] };
}

function opencodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg !== "" ? xdg : join(homedir(), ".config"), "opencode");
}

/** Config dir whose presence means the app is installed for this user. */
function appMarkerDir(app: App): string {
  if (app === "claude") return join(homedir(), ".claude");
  if (app === "codex") return join(homedir(), ".codex");
  return opencodeConfigDir();
}

/** Read a JSON config file; missing file is an empty object, bad JSON throws. */
async function readJsonFile(file: string): Promise<Record<string, unknown>> {
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("top-level value is not an object");
  }
  return parsed as Record<string, unknown>;
}

async function writeFileEnsuringDir(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

/**
 * Ensure a SessionStart command hook exists in a Claude-Code-shaped settings
 * object (Codex hooks.json uses the same event → matcher-group → handlers
 * shape). Repairs a stale sv-axi command in place (AXI §7 path repair) and
 * no-ops when the exact command is already registered (§7 idempotent).
 */
function mergeSessionStart(
  settings: Record<string, unknown>,
  command: string,
): "installed" | "updated" | "ok" {
  if (settings.hooks !== undefined && (typeof settings.hooks !== "object" || settings.hooks === null || Array.isArray(settings.hooks))) {
    throw new Error("existing `hooks` value is not an object");
  }
  const hooks = (settings.hooks ??= {}) as Record<string, unknown>;
  if (hooks.SessionStart !== undefined && !Array.isArray(hooks.SessionStart)) {
    throw new Error("existing `hooks.SessionStart` is not an array");
  }
  const groups = (hooks.SessionStart ??= []) as Array<Record<string, unknown>>;

  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    for (const handler of group.hooks as Array<Record<string, unknown>>) {
      if (typeof handler?.command !== "string") continue;
      if (handler.command === command) return "ok";
      if (handler.command.includes("sv-axi")) {
        handler.command = command;
        return "updated";
      }
    }
  }

  groups.push({ hooks: [{ type: "command", command }] });
  return "installed";
}

/** Install/repair the SessionStart hook in a JSON settings file. */
async function installJsonHook(
  file: string,
  command: string,
): Promise<"installed" | "updated" | "ok"> {
  let settings: Record<string, unknown>;
  try {
    settings = await readJsonFile(file);
  } catch (err) {
    throw new Error(`cannot update ${tilde(file)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const status = mergeSessionStart(settings, command);
  if (status !== "ok") {
    await writeFileEnsuringDir(file, JSON.stringify(settings, null, 2) + "\n");
  }
  return status;
}

/**
 * Ensure `hooks = true` under `[features]` in a Codex config.toml, editing the
 * text minimally so unrelated user config is untouched.
 */
function ensureFeaturesHooks(toml: string): { content: string; changed: boolean } {
  const header = /^\s*\[features\]\s*$/m.exec(toml);
  if (!header) {
    const sep = toml === "" || toml.endsWith("\n") ? "" : "\n";
    return { content: `${toml}${sep}\n[features]\nhooks = true\n`, changed: true };
  }

  const bodyStart = header.index + header[0].length;
  const nextSection = toml.slice(bodyStart).search(/^\s*\[/m);
  const bodyEnd = nextSection === -1 ? toml.length : bodyStart + nextSection;
  const body = toml.slice(bodyStart, bodyEnd);

  if (/^\s*hooks\s*=\s*true\s*(#.*)?$/m.test(body)) return { content: toml, changed: false };

  const existing = /^\s*hooks\s*=.*$/m.exec(body);
  if (existing) {
    const patched = body.slice(0, existing.index) + "hooks = true" + body.slice(existing.index + existing[0].length);
    return { content: toml.slice(0, bodyStart) + patched + toml.slice(bodyEnd), changed: true };
  }

  return {
    content: toml.slice(0, bodyStart) + "\nhooks = true" + toml.slice(bodyStart, bodyEnd) + toml.slice(bodyEnd),
    changed: true,
  };
}

async function setupClaude(scope: Scope, cwd: string, cmd: HookCommand): Promise<SetupRow> {
  const dir = scope === "user" ? join(homedir(), ".claude") : join(cwd, ".claude");
  const file = join(dir, "settings.json");
  const status = await installJsonHook(file, cmd.shell);
  return { app: "claude", status, target: tilde(file) };
}

async function setupCodex(scope: Scope, cwd: string, cmd: HookCommand): Promise<SetupRow> {
  const dir = scope === "user" ? join(homedir(), ".codex") : join(cwd, ".codex");
  const file = join(dir, "hooks.json");
  let status: string = await installJsonHook(file, cmd.shell);

  // Hooks are feature-gated; enable them in the user-layer config.toml so the
  // hook actually fires regardless of which layer holds hooks.json.
  const configFile = join(homedir(), ".codex", "config.toml");
  const before = existsSync(configFile) ? await readFile(configFile, "utf8") : "";
  const { content, changed } = ensureFeaturesHooks(before);
  if (changed) {
    await writeFileEnsuringDir(configFile, content);
    if (status === "ok") status = "updated";
  }
  return { app: "codex", status, target: tilde(file) };
}

const PLUGIN_MARKER = "// managed by `sv-axi setup` — edits are overwritten on re-run";

/**
 * OpenCode plugin source. Injects the sv-axi session view into the system
 * context; `sv-axi --session` prints nothing outside SvelteKit projects, so
 * the plugin stays silent there too.
 */
function pluginSource(cmd: HookCommand): string {
  return `${PLUGIN_MARKER}
import { execFile } from "node:child_process"

const BIN = ${JSON.stringify(cmd.bin)}
const ARGS = ${JSON.stringify(cmd.args)}

function load(cwd) {
  return new Promise((resolve) => {
    execFile(BIN, ARGS, { cwd, timeout: 10_000 }, (err, stdout) => {
      resolve(err ? "" : String(stdout).trim())
    })
  })
}

export const SvAxi = async ({ directory }) => {
  let cached
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (cached === undefined) cached = await load(directory)
      if (cached) output.system.push("Current SvelteKit project state (from sv-axi):\\n" + cached)
    },
  }
}
`;
}

async function setupOpencode(scope: Scope, cwd: string, cmd: HookCommand): Promise<SetupRow> {
  const base = scope === "user" ? opencodeConfigDir() : join(cwd, ".opencode");
  const file = join(base, "plugins", "sv-axi.js");
  const next = pluginSource(cmd);

  let status: string;
  if (!existsSync(file)) {
    status = "installed";
  } else {
    const current = await readFile(file, "utf8");
    if (current === next) {
      return { app: "opencode", status: "ok", target: tilde(file) };
    }
    if (!current.startsWith(PLUGIN_MARKER)) {
      throw new Error(`${tilde(file)} exists but is not managed by sv-axi — remove it and re-run`);
    }
    status = "updated";
  }
  await writeFileEnsuringDir(file, next);
  return { app: "opencode", status, target: tilde(file) };
}

const INSTALLERS: Record<App, (scope: Scope, cwd: string, cmd: HookCommand) => Promise<SetupRow>> = {
  claude: setupClaude,
  codex: setupCodex,
  opencode: setupOpencode,
};

/** `sv-axi setup` subcommand. */
export async function runSetup(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    emit({ help: SETUP_HELP });
    return EXIT.OK;
  }

  const parsed = parseFlags(args, SETUP_FLAGS);
  if (parsed.unknown) {
    return emitError(`unknown flag ${parsed.unknown} for \`setup\``, {
      help: "valid flags for `setup`: --app, --scope, --cwd (--help always allowed)",
      code: EXIT.USAGE,
    });
  }
  if (parsed.error) {
    return emitError(parsed.error, { help: SETUP_HELP, code: EXIT.USAGE });
  }

  const app = parsed.flags.app as string;
  if (app !== "all" && !APPS.includes(app as App)) {
    return emitError(`unknown app \`${app}\``, {
      help: `valid values for --app: ${APPS.join(", ")}, all`,
      code: EXIT.USAGE,
    });
  }
  const scope = parsed.flags.scope as string;
  if (scope !== "project" && scope !== "user") {
    return emitError(`unknown scope \`${scope}\``, {
      help: "valid values for --scope: project, user",
      code: EXIT.USAGE,
    });
  }

  const cwd = resolve((parsed.flags.cwd as string | undefined) ?? process.cwd());
  const cmd = hookCommand();
  const targets: App[] = app === "all" ? [...APPS] : [app as App];

  const rows: SetupRow[] = [];
  for (const target of targets) {
    // With --app all, only touch apps that appear installed (AXI §7 explicit
    // opt-in stays scoped); naming an app explicitly always installs.
    if (app === "all" && !existsSync(appMarkerDir(target))) {
      rows.push({
        app: target,
        status: `skipped (no ${tilde(appMarkerDir(target))})`,
        target: "-",
      });
      continue;
    }
    try {
      rows.push(await INSTALLERS[target](scope, cwd, cmd));
    } catch (err) {
      rows.push({
        app: target,
        status: `error: ${err instanceof Error ? err.message : String(err)}`,
        target: "-",
      });
    }
  }

  const help: string[] = [];
  if (rows.some((r) => r.status === "installed" || r.status === "updated" || r.status === "ok")) {
    help.push("Start a new agent session in this project to see sv-axi context load automatically");
  }
  if (rows.some((r) => r.status.startsWith("skipped"))) {
    help.push("Run `sv-axi setup --app <name>` to install for a skipped app anyway");
  }
  if (scope === "project" && !existsSync(join(cwd, "src", "routes"))) {
    help.push(`No src/routes under ${tilde(cwd)} yet — the hook stays quiet until routes exist`);
  }

  emit({ command: cmd.shell, setup: rows, help });
  return rows.some((r) => r.status.startsWith("error")) ? EXIT.ERROR : EXIT.OK;
}
