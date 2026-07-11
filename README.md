<h1 align="center">sv-axi</h1>

<p align="center">
  An <a href="https://toonformat.dev/">AXI</a>-compliant CLI for inspecting SvelteKit
  projects — built for coding agents to drive over the shell.
</p>

---

`sv-axi` follows the **Agent eXperience Interface (AXI)** standards: token-efficient
[TOON](https://toonformat.dev/) output, minimal default schemas, structured errors,
predictable exit codes, and a content-first home view. Running it with no arguments
shows the current project's routes so an agent can act immediately.

> **Status:** skeleton. The AXI-compliant plumbing (arg parsing, TOON output boundary,
> structured errors, exit codes, help) and one example command (`routes`) are in place.
> Add commands under `src/commands/` and register them in `src/cli.ts`.

## Install

```sh
npm install
npm run build      # compiles src/ → dist/
```

For local use on your PATH:

```sh
npm link           # exposes the `sv-axi` binary
```

## Usage

```sh
sv-axi                       # home view: bin, description, and this project's routes
sv-axi routes                # list SvelteKit routes in the current directory
sv-axi routes --cwd ../app   # inspect a different project root
sv-axi routes --limit 500    # raise the list cap (default 200)
sv-axi --help                # top-level command reference
sv-axi routes --help         # per-command reference
```

Example output (TOON):

```
count: 7 of 7 total
routes[7]{route,kind,file}:
  /,page,+page.svelte
  /,layout,+layout.svelte
  /api/posts,endpoint,+server.ts
  "/blog/[slug]",page,+page.svelte
  ...
```

### Conventions (AXI)

- **stdout** carries all structured output the agent reads — data *and* errors, as TOON.
- **stderr** carries diagnostics only (`debug()` in `src/output.ts`).
- **Exit codes:** `0` success (incl. no-ops), `1` runtime error, `2` usage error.
- Unknown flags and commands fail loud with the valid set inlined, never silently dropped.

## Project layout

```
src/
  index.ts            entry (shebang) — turns run() into a process exit code
  cli.ts              command registry, dispatch, home view, top-level help
  flags.ts            flag parser with unknown-flag rejection
  output.ts           TOON output boundary, structured errors, exit codes
  commands/
    routes.ts         example command: scan src/routes and list routes
```

To add a command: create `src/commands/<name>.ts` exporting a `run(args): Promise<number>`,
then add it to the `COMMANDS` array in `src/cli.ts`. Keep default schemas small (3–4
fields), include a total count on lists, and emit errors via `emitError()`.

## Agent integration

AXI recommends two complementary ways to put `sv-axi` in front of an agent (a user needs
only one). Both are TODO for this skeleton:

1. **Session hook (primary)** — register a `SessionStart` hook (Claude Code / Codex) or a
   plugin (OpenCode) that runs `sv-axi` so every session starts with the route list as
   ambient context. Wire this up behind an explicit `sv-axi setup` command.
2. **Installable skill (secondary)** — ship a `SKILL.md` generated from the home view so
   any skill-aware agent can load `sv-axi` on demand:
   ```sh
   npx skills add <owner>/sv-axi --skill sv-axi
   ```

See `.agents/skills/axi/SKILL.md` in this repo for the full AXI standard.

## Development

```sh
npm run dev         # tsc --watch
npm run typecheck   # tsc --noEmit
npm run build       # emit dist/
```

## License

MIT
