import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { candidateRows, discover, displayPath, projectVersions } from "../dist/project.js";
import { fixture, kitFixture } from "./helpers.js";

describe("discover", () => {
  it("finds the project root from the root itself", async () => {
    const root = kitFixture("proj-root", { "src/routes/+page.svelte": "" });
    const found = await discover(root);
    assert.equal(found.project?.root, root);
    assert.equal(found.project?.routesDir, join(root, "src", "routes"));
    assert.equal(found.project?.libDir, join(root, "src", "lib"));
  });

  it("finds the project root by searching upward from a nested directory", async () => {
    const root = kitFixture("proj-nested", {
      "src/routes/blog/deep/+page.svelte": "",
    });
    const found = await discover(join(root, "src", "routes", "blog", "deep"));
    assert.equal(found.project?.root, root);
  });

  it("reports the Svelte and Kit versions from package.json", async () => {
    const root = kitFixture("proj-versions", { "src/routes/+page.svelte": "" });
    const found = await discover(root);
    assert.equal(found.project?.versions, "svelte ^5.0.0, kit ^2.0.0");
  });

  it("scans `src` only, when routes and lib live inside it", async () => {
    const root = kitFixture("proj-scandirs", {
      "src/routes/+page.svelte": "",
      "src/lib/Button.svelte": "",
    });
    const found = await discover(root);
    assert.deepEqual(found.project?.scanDirs, [join(root, "src")]);
  });

  it("returns a configured project that has no routes directory yet", async () => {
    const root = kitFixture("proj-fresh");
    const found = await discover(root);
    assert.equal(found.project?.root, root);
    assert.deepEqual(found.candidates, []);
  });

  it("honours a literal `kit.files.routes`", async () => {
    const root = kitFixture("proj-kitfiles", {
      "svelte.config.js":
        "export default { kit: { files: { routes: 'source/pages', lib: 'source/shared' } } };\n",
      "source/pages/+page.svelte": "",
      "source/shared/Button.svelte": "",
    });
    const found = await discover(root);
    assert.equal(found.project?.routesDir, join(root, "source", "pages"));
    assert.equal(found.project?.libDir, join(root, "source", "shared"));
    assert.equal(found.project?.configUnresolved, undefined);
    // `src` does not exist here, so the configured dirs are what gets scanned.
    assert.deepEqual(found.project?.scanDirs.sort(), [
      join(root, "source", "pages"),
      join(root, "source", "shared"),
    ]);
  });

  it("flags a `kit.files` path it could neither read nor evaluate", async () => {
    const root = kitFixture("proj-unresolved", {
      // Non-literal path, and importing the config throws — so neither the text
      // scan nor evaluation can resolve it.
      "svelte.config.js":
        "const dir = globalThis.__missing__.routes;\n" +
        "export default { kit: { files: { routes: dir, lib: 'src/lib' } } };\n",
      "src/routes/+page.svelte": "",
    });
    const found = await discover(root);
    assert.equal(found.project?.configUnresolved, true);
    assert.equal(found.project?.routesDir, join(root, "src", "routes"));
  });

  it("returns every project in a monorepo as candidates rather than guessing", async () => {
    const root = fixture("mono", {
      "package.json": JSON.stringify({ name: "mono", private: true }),
      "apps/web/package.json": JSON.stringify({
        name: "web",
        devDependencies: { "@sveltejs/kit": "^2.0.0" },
      }),
      "apps/web/svelte.config.js": "export default { kit: {} };\n",
      "apps/web/src/routes/+page.svelte": "",
      "apps/admin/package.json": JSON.stringify({
        name: "admin",
        devDependencies: { "@sveltejs/kit": "^2.0.0" },
      }),
      "apps/admin/svelte.config.js": "export default { kit: {} };\n",
      "apps/admin/src/routes/+page.svelte": "",
    });
    const found = await discover(root);
    assert.equal(found.project, undefined);
    assert.deepEqual(
      found.candidates.map((c) => c.root),
      [join(root, "apps", "admin"), join(root, "apps", "web")],
    );
  });

  it("picks the single project found beneath the starting directory", async () => {
    const root = fixture("mono-single", {
      "apps/web/package.json": JSON.stringify({
        name: "web",
        devDependencies: { "@sveltejs/kit": "^2.0.0" },
      }),
      "apps/web/svelte.config.js": "export default { kit: {} };\n",
      "apps/web/src/routes/+page.svelte": "",
    });
    const found = await discover(root);
    assert.equal(found.project?.root, join(root, "apps", "web"));
  });

  it("prefers the app the search started in over its siblings", async () => {
    const root = fixture("mono-inside", {
      "apps/web/package.json": JSON.stringify({ name: "web" }),
      "apps/web/svelte.config.js": "export default { kit: {} };\n",
      "apps/web/src/routes/+page.svelte": "",
      "apps/admin/package.json": JSON.stringify({ name: "admin" }),
      "apps/admin/svelte.config.js": "export default { kit: {} };\n",
      "apps/admin/src/routes/+page.svelte": "",
    });
    const found = await discover(join(root, "apps", "web", "src"));
    assert.equal(found.project?.root, join(root, "apps", "web"));
  });

  it("ignores node_modules when scanning downward", async () => {
    const root = fixture("mono-node-modules", {
      "node_modules/some-pkg/svelte.config.js": "export default { kit: {} };\n",
      "node_modules/some-pkg/src/routes/+page.svelte": "",
    });
    const found = await discover(root);
    assert.equal(found.project, undefined);
    assert.deepEqual(found.candidates, []);
  });

  it("finds nothing in a directory with no Svelte project", async () => {
    const root = fixture("no-project", { "readme.md": "# nothing here\n" });
    const found = await discover(root);
    assert.equal(found.project, undefined);
    assert.deepEqual(found.candidates, []);
    assert.equal(found.searchedFrom, root);
  });
});

describe("projectVersions", () => {
  it("joins the versions it finds", () => {
    const root = kitFixture("versions-both");
    assert.equal(projectVersions(root), "svelte ^5.0.0, kit ^2.0.0");
  });

  it("returns undefined when neither dependency is present", () => {
    const root = fixture("versions-none", {
      "package.json": JSON.stringify({ name: "x", dependencies: { lodash: "^4" } }),
    });
    assert.equal(projectVersions(root), undefined);
  });

  it("returns undefined when package.json is missing or unparseable", () => {
    const missing = fixture("versions-missing");
    const broken = fixture("versions-broken", { "package.json": "{ not json" });
    assert.equal(projectVersions(missing), undefined);
    assert.equal(projectVersions(broken), undefined);
  });
});

describe("displayPath", () => {
  it("returns `.` for the directory itself", () => {
    assert.equal(displayPath("/a/b", "/a/b"), ".");
  });

  it("relativizes a path below the reference directory", () => {
    assert.equal(displayPath("/a/b/apps/web", "/a/b"), join("apps", "web"));
  });

  it("keeps the absolute path when the target is outside", () => {
    assert.equal(displayPath("/other/place", "/a/b"), "/other/place");
  });
});

describe("candidateRows", () => {
  it("renders one row per candidate, with an empty string for unknown versions", () => {
    const rows = candidateRows([
      { root: process.cwd(), versions: "svelte ^5.0.0" },
      { root: process.cwd() },
    ]);
    assert.deepEqual(rows, [
      { path: ".", versions: "svelte ^5.0.0" },
      { path: ".", versions: "" },
    ]);
  });
});
