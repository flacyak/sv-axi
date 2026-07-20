<h1 align="center">sv-axi</h1>
<p align="center">
  A CLI for inspecting SvelteKit projects and fetching official Svelte docs —
  built for coding agents to drive over the shell.
</p>

---

A token-efficient view of SvelteKit projects over shell

- [AXI](https://axi.md/) interface.
- [TOON](https://toonformat.dev/) structured output, predictable exit codes

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
sv-axi routes                # list the project's routes (found from the current directory)
sv-axi routes --cwd apps/web # start the search somewhere else — e.g. one app in a monorepo
sv-axi reactant              # map components: props + change types (runes, stores, legacy)
sv-axi check [files...]      # flag outdated Svelte patterns, with the modern fix for each
sv-axi docs                  # list official docs sections (offline index)
sv-axi docs kit/load         # fetch one section live from svelte.dev (--full for all of it)
sv-axi setup                 # register session-start hooks (Claude Code, Codex, OpenCode)
sv-axi --session             # hook variant of the home view: trimmed, silent outside SvelteKit
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

## Interaction

There are 2 ways to get `sv-axi` in front of an agent:

1. **Session hook (primary)** — run `sv-axi setup` in a project to register a
   `SessionStart` hook (Claude Code, Codex) and a managed plugin (OpenCode) that run
   `sv-axi --session`, so every session starts with the route list as ambient context.

   ```sh
   sv-axi setup                 # project scope, every app whose config dir exists
   sv-axi setup --app claude    # one app, installed even when not auto-detected
   sv-axi setup --scope user    # user-level config instead of the project's
   sv-axi --session             # cap output to SV projects
   ```

   `sv-axi` on PATH, else absolute path needed.
   **Codex**: sets `[features].hooks = true` in `~/.codex/config.toml`.

2. **Installable skill (TODO: 0.0.4)** — ship a `SKILL.md` generated from the home
   view so any skill-aware agent can load `sv-axi` on demand:

   ```sh
   npx skills add <owner>/sv-axi --skill sv-axi
   ```

See `.agents/skills/axi/SKILL.md` in this repo for the full AXI standard.

```

## License

MIT
```
