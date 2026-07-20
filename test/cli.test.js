import assert from "node:assert/strict";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { fixture, kitFixture, runCli, toon } from "./helpers.js";

/**
 * End-to-end coverage of the shipped binary: exit codes and parsed TOON.
 * Exit codes are the contract an agent branches on — 0 success, 1 runtime
 * error, 2 usage error — so they are asserted on every path.
 */

let project;
let empty;
let mono;

/**
 * The fixture project the command tests run against:
 *
 *   cli-project/
 *     .git/                  root marker — stops the upward project search
 *     package.json           svelte ^5.0.0, kit ^2.0.0
 *     svelte.config.js       no `kit.files`, so the defaults apply
 *     src/
 *       routes/
 *         +page.svelte       /        page
 *         about/
 *           +page.svelte     /about   page
 *         api/
 *           +server.ts       /api     endpoint
 *       lib/
 *         Button.svelte      runes — `let { label } = $props()`
 *         Legacy.svelte      pre-runes — `export let label`
 *
 * Three route files and two components: one idiomatic, one carrying a single
 * `export-let` issue so `check` has exactly one thing to find.
 */
before(() => {
  project = kitFixture("cli-project", {
    "src/routes/+page.svelte": "<h1>home</h1>\n",
    "src/routes/about/+page.svelte": "<h1>about</h1>\n",
    "src/routes/api/+server.ts": "export function GET() {}\n",
    "src/lib/Button.svelte": "<script>\n  let { label } = $props();\n</script>\n",
    "src/lib/Legacy.svelte": "<script>\n  export let label;\n</script>\n",
  });
  empty = fixture("cli-empty", { "readme.md": "# nothing\n" });
  mono = fixture("cli-mono", {
    "apps/web/package.json": JSON.stringify({ name: "web" }),
    "apps/web/svelte.config.js": "export default { kit: {} };\n",
    "apps/web/src/routes/+page.svelte": "",
    "apps/admin/package.json": JSON.stringify({ name: "admin" }),
    "apps/admin/svelte.config.js": "export default { kit: {} };\n",
    "apps/admin/src/routes/+page.svelte": "",
  });
});

describe("home view", () => {
  it("lists the current project's routes with no arguments", async () => {
    const { code, stdout } = await runCli([], project);
    assert.equal(code, 0);
    const out = toon(stdout);
    assert.ok(out.bin);
    assert.ok(out.description);
    assert.equal(out.count, "3 of 3 total");
    assert.equal(out.versions, "svelte ^5.0.0, kit ^2.0.0");
    assert.deepEqual(
      out.routes.map((r) => r.route).sort(),
      ["/", "/about", "/api"],
    );
  });

  it("succeeds and explains itself outside a Svelte project", async () => {
    const { code, stdout } = await runCli([], empty);
    assert.equal(code, 0);
    const out = toon(stdout);
    assert.match(out.routes, /no SvelteKit project found/);
    assert.ok(out.help.length > 0);
  });

  it("lists the projects it found in a monorepo root", async () => {
    const { code, stdout } = await runCli([], mono);
    assert.equal(code, 0);
    const out = toon(stdout);
    assert.equal(out.projects.length, 2);
    assert.match(out.count, /2 SvelteKit projects/);
  });
});

describe("--session", () => {
  it("prints project context inside a project", async () => {
    const { code, stdout } = await runCli(["--session"], project);
    assert.equal(code, 0);
    assert.ok(toon(stdout).routes.length > 0);
  });

  it("prints nothing at all outside a project", async () => {
    const { code, stdout } = await runCli(["--session"], empty);
    assert.equal(code, 0);
    assert.equal(stdout, "");
  });
});

describe("top-level usage errors", () => {
  it("exits 0 for --help and names every command", async () => {
    const { code, stdout } = await runCli(["--help"], project);
    assert.equal(code, 0);
    for (const name of ["routes", "reactant", "check", "docs", "setup"]) {
      assert.match(stdout, new RegExp(name));
    }
  });

  it("exits 2 for an unknown command", async () => {
    const { code, stdout } = await runCli(["bogus"], project);
    assert.equal(code, 2);
    assert.match(toon(stdout).error, /unknown command/);
  });

  it("exits 2 for an unknown top-level flag", async () => {
    const { code, stdout } = await runCli(["--nope"], project);
    assert.equal(code, 2);
    assert.match(toon(stdout).error, /unknown flag/);
  });
});

describe("routes", () => {
  it("lists routes and reports the total", async () => {
    const { code, stdout } = await runCli(["routes"], project);
    assert.equal(code, 0);
    const out = toon(stdout);
    assert.equal(out.count, "3 of 3 total");
    assert.equal(out.root, ".");
  });

  it("resolves --cwd from elsewhere", async () => {
    const { code, stdout } = await runCli(["routes", "--cwd", project], empty);
    assert.equal(code, 0);
    assert.equal(toon(stdout).count, "3 of 3 total");
  });

  it("caps output at --limit and says how to see the rest", async () => {
    const { code, stdout } = await runCli(["routes", "--limit", "2"], project);
    assert.equal(code, 0);
    const out = toon(stdout);
    assert.equal(out.count, "2 of 3 total");
    assert.equal(out.routes.length, 2);
    assert.match(out.help[0], /--limit 3/);
  });

  it("exits 2 for an unknown flag, naming the valid ones", async () => {
    const { code, stdout } = await runCli(["routes", "--stat"], project);
    assert.equal(code, 2);
    const out = toon(stdout);
    assert.match(out.error, /--stat/);
    assert.match(out.help, /--cwd/);
  });

  it("exits 2 when a flag is missing its value", async () => {
    const { code, stdout } = await runCli(["routes", "--cwd"], project);
    assert.equal(code, 2);
    assert.match(toon(stdout).error, /requires a value/);
  });

  it("exits 1 with no project, saying where it looked", async () => {
    const { code, stdout } = await runCli(["routes"], empty);
    assert.equal(code, 1);
    const out = toon(stdout);
    assert.match(out.error, /no SvelteKit project found/);
    assert.ok(out.help.length > 0);
  });

  it("exits 2 on an ambiguous monorepo and lists the candidates", async () => {
    const { code, stdout } = await runCli(["routes"], mono);
    assert.equal(code, 2);
    const out = toon(stdout);
    assert.match(out.error, /pass --cwd to pick one/);
    assert.equal(out.projects.length, 2);
    assert.match(out.help, /--cwd/);
  });

  it("exits 0 for --help", async () => {
    const { code, stdout } = await runCli(["routes", "--help"], project);
    assert.equal(code, 0);
    assert.match(stdout, /sv-axi routes/);
  });
});

describe("reactant", () => {
  it("maps components to their props and change types", async () => {
    const { code, stdout } = await runCli(["reactant"], project);
    assert.equal(code, 0);
    const out = toon(stdout);
    const byFile = Object.fromEntries(out.components.map((c) => [c.file, c]));

    assert.equal(byFile["src/lib/Button.svelte"].props, "label");
    assert.equal(byFile["src/lib/Button.svelte"].reacts, "props");
    assert.equal(byFile["src/lib/Legacy.svelte"].reacts, "props+legacy");
  });

  it("exits 2 for an unknown flag", async () => {
    const { code } = await runCli(["reactant", "--stat"], project);
    assert.equal(code, 2);
  });
});

describe("check", () => {
  it("reports issues but still exits 0, so it can be re-run until clean", async () => {
    const { code, stdout } = await runCli(["check"], project);
    assert.equal(code, 0);
    const out = toon(stdout);
    assert.ok(out.issues.some((i) => i.rule === "export-let"));
    assert.ok(out.issues.every((i) => i.line > 0));
  });

  it("checks only the files it is given", async () => {
    const { code, stdout } = await runCli(
      ["check", join("src", "lib", "Button.svelte")],
      project,
    );
    assert.equal(code, 0);
    assert.match(toon(stdout).check, /0 issues found in 1 \.svelte file/);
  });

  it("exits 1 for a file that does not exist", async () => {
    const { code, stdout } = await runCli(["check", "nope.svelte"], project);
    assert.equal(code, 1);
    assert.match(toon(stdout).error, /no such file/);
  });
});

describe("docs", () => {
  it("lists sections without touching the network", async () => {
    const { code, stdout } = await runCli(["docs", "--pkg", "kit"], project);
    assert.equal(code, 0);
    const out = toon(stdout);
    assert.ok(out.sections.length > 0);
    assert.ok(out.sections.every((s) => s.slug.startsWith("kit/")));
  });

  it("exits 2 for an unknown package", async () => {
    const { code, stdout } = await runCli(["docs", "--pkg", "bogus"], project);
    assert.equal(code, 2);
    assert.match(toon(stdout).error, /unknown package/);
  });

  it("exits 2 for an unknown section slug", async () => {
    const { code, stdout } = await runCli(["docs", "not-a-real-section"], project);
    assert.equal(code, 2);
    assert.match(toon(stdout).error, /unknown docs section/);
  });

  it("exits 2 for more than one slug", async () => {
    const { code, stdout } = await runCli(["docs", "kit/load", "svelte/what"], project);
    assert.equal(code, 2);
    assert.match(toon(stdout).error, /at most one section slug/);
  });
});

describe("setup", () => {
  it("exits 0 for --help without writing anything", async () => {
    const { code, stdout } = await runCli(["setup", "--help"], project);
    assert.equal(code, 0);
    assert.match(stdout, /sv-axi setup/);
  });

  it("exits 2 for an unknown flag", async () => {
    const { code } = await runCli(["setup", "--stat"], project);
    assert.equal(code, 2);
  });
});
