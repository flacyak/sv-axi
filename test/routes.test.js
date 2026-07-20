import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectRoutes } from "../dist/commands/routes.js";
import { discover } from "../dist/project.js";
import { kitFixture } from "./helpers.js";

/** Discover the fixture project and collect its routes. */
async function routesOf(root) {
  const found = await discover(root);
  return collectRoutes(found.project);
}

describe("collectRoutes", () => {
  it("maps route files to URL paths, kinds, and file names", async () => {
    const root = kitFixture("routes-basic", {
      "src/routes/+layout.svelte": "",
      "src/routes/+page.svelte": "",
      "src/routes/+error.svelte": "",
      "src/routes/about/+page.svelte": "",
      "src/routes/blog/[slug]/+page.svelte": "",
      "src/routes/api/items/+server.ts": "",
      "src/routes/+custom.ts": "",
    });

    const result = await routesOf(root);
    assert.deepEqual(result.rows, [
      { route: "/", kind: "other", file: "+custom.ts" },
      { route: "/", kind: "error", file: "+error.svelte" },
      { route: "/", kind: "layout", file: "+layout.svelte" },
      { route: "/", kind: "page", file: "+page.svelte" },
      { route: "/about", kind: "page", file: "+page.svelte" },
      { route: "/api/items", kind: "endpoint", file: "+server.ts" },
      { route: "/blog/[slug]", kind: "page", file: "+page.svelte" },
    ]);
  });

  it("drops `(group)` folders from the URL path", async () => {
    const root = kitFixture("routes-groups", {
      "src/routes/(marketing)/+layout.svelte": "",
      "src/routes/(marketing)/blog/+page.svelte": "",
      "src/routes/(app)/(admin)/users/+page.svelte": "",
    });

    const result = await routesOf(root);
    assert.deepEqual(
      result.rows.map((r) => r.route),
      ["/users", "/", "/blog"],
    );
  });

  it("ignores files that do not start with `+`", async () => {
    const root = kitFixture("routes-noise", {
      "src/routes/+page.svelte": "",
      "src/routes/utils.ts": "",
      "src/routes/components/Card.svelte": "",
    });

    const result = await routesOf(root);
    assert.deepEqual(
      result.rows.map((r) => r.file),
      ["+page.svelte"],
    );
  });

  it("counts `+page.server.ts` as a page", async () => {
    const root = kitFixture("routes-server-page", {
      "src/routes/+page.server.ts": "",
      "src/routes/+layout.server.ts": "",
    });

    const result = await routesOf(root);
    assert.deepEqual(
      result.rows.map((r) => r.kind),
      ["layout", "page"],
    );
  });

  it("follows a configured `kit.files.routes`", async () => {
    const root = kitFixture("routes-configured", {
      "svelte.config.js": "export default { kit: { files: { routes: 'source/pages' } } };\n",
      "source/pages/about/+page.svelte": "",
    });

    const result = await routesOf(root);
    assert.deepEqual(
      result.rows.map((r) => r.route),
      ["/about"],
    );
  });

  it("returns an empty row set for a routes directory with no route files", async () => {
    const root = kitFixture("routes-empty", { "src/routes/.keep": "" });
    const result = await routesOf(root);
    assert.deepEqual(result.rows, []);
  });

  it("returns null when the routes directory does not exist", async () => {
    const root = kitFixture("routes-absent");
    assert.equal(await routesOf(root), null);
  });
});
