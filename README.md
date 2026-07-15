<h1 align="center">sv-axi</h1>
<p align="center">
  A CLI for inspecting SvelteKit projects and fetching official Svelte docs —
  built for coding agents to drive over the shell.
</p>

---

`sv-axi` gives agents a token-efficient view of SvelteKit projects and official docs over shell

- [AXI](https://axi.md/) interface.
- [TOON](https://toonformat.dev/) output, structured errors, predictable exit codes

## Quick Start

```sh
npx skills add flacyak/sv-axi --skill sv
```

## Local Install

```sh
npm install
npm run build      # compile dist
npm link           # add local to PATH
```

## Usage

```sh
sv-axi                       # home view: bin, svelte/kit versions, project routes
sv-axi routes                # list routes in the current directory
sv-axi reactant              # map components: props + change types (runes, stores, legacy)
sv-axi check [files...]      # flag outdated Svelte patterns, with the modern fix for each
sv-axi docs                  # list official docs sections (offline index)
sv-axi docs kit/load         # fetch one section live from svelte.dev (--full for all of it)
```

Example output:

```
$ sv-axi reactant
count: 4 of 4 total
components[4]{file,props,reacts}:
  src/lib/Counter.svelte,count+step,props+derived+effect+context
  src/routes/+layout.svelte,children,props
  src/routes/+page.svelte,data,props+state+derived
  "src/routes/blog/[slug]/+page.svelte",post,props+legacy
help[1]: Run `sv-axi check <file>` to flag outdated patterns in a component

$ sv-axi check
count: 2 of 2 total
issues[2]{file,line,rule,fix}:
  "src/routes/blog/[slug]/+page.svelte",2,export-let,"declare props with `let { … } = $props()`"
  "src/routes/blog/[slug]/+page.svelte",7,on-directive,"use event attributes: `onclick={…}` instead of `on:click`"
```

`check` always exits 0 — findings are data, not failures; agents re-run it
until it reports `0 issues`. The docs section index is generated at build time
(`npm run gen:docs`) so listing costs no network call; fetching a section pulls
the live `llms.txt` from svelte.dev, truncated to 2000 chars unless `--full`.

### Conventions (AXI)

- **stdout** carries all structured output the agent reads — data _and_ errors, as TOON.
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
  docs-index.ts       generated docs section index (npm run gen:docs)
  commands/
    routes.ts         scan src/routes and list routes
    reactant.ts       map components to their props and change types
    check.ts          static checks for outdated Svelte patterns
    docs.ts           list sections offline, fetch one live from svelte.dev
scripts/
  gen-docs-index.mjs  regenerate src/docs-index.ts from svelte.dev/content.json
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
