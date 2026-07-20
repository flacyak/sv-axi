import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { checkFile } from "../dist/commands/check.js";
import { fixture } from "./helpers.js";

/** Write `source` as a component and return the issues found in it. */
async function issuesIn(name, source) {
  const root = fixture(`check-${name}`, { "Component.svelte": source });
  return checkFile(join(root, "Component.svelte"), root);
}

/** The rule names triggered by `source`, deduplicated. */
async function rulesIn(name, source) {
  return new Set((await issuesIn(name, source)).map((i) => i.rule));
}

describe("checkFile — rules", () => {
  it("flags `export let` props", async () => {
    assert.ok((await rulesIn("export-let", "export let name;")).has("export-let"));
  });

  it("flags reactive labels", async () => {
    assert.ok((await rulesIn("label", "$: doubled = count * 2;")).has("reactive-label"));
  });

  it("flags `on:` directives", async () => {
    const rules = await rulesIn("on-dir", "<button on:click={go}>go</button>");
    assert.ok(rules.has("on-directive"));
  });

  it("does not flag modern event attributes", async () => {
    const rules = await rulesIn("on-attr", "<button onclick={go}>go</button>");
    assert.ok(!rules.has("on-directive"));
  });

  it("flags createEventDispatcher", async () => {
    const rules = await rulesIn("dispatch", "const dispatch = createEventDispatcher();");
    assert.ok(rules.has("event-dispatcher"));
  });

  it("flags the removed update lifecycle hooks", async () => {
    assert.ok((await rulesIn("before", "beforeUpdate(() => {});")).has("lifecycle-update"));
    assert.ok((await rulesIn("after", "afterUpdate(() => {});")).has("lifecycle-update"));
  });

  it("flags `<slot>`", async () => {
    assert.ok((await rulesIn("slot-self", "<slot />")).has("slot-element"));
    assert.ok((await rulesIn("slot-open", "<slot></slot>")).has("slot-element"));
  });

  it("flags `$$props` and `$$restProps`", async () => {
    assert.ok((await rulesIn("dollar", "<div {...$$restProps} />")).has("dollar-props"));
    assert.ok((await rulesIn("dollar2", "const all = $$props;")).has("dollar-props"));
  });

  it("flags `<svelte:component>`", async () => {
    const rules = await rulesIn("svelte-comp", "<svelte:component this={Icon} />");
    assert.ok(rules.has("svelte-component"));
  });

  it("flags an unkeyed each block", async () => {
    assert.ok((await rulesIn("each-unkeyed", "{#each items as item}")).has("unkeyed-each"));
  });

  it("does not flag a keyed each block", async () => {
    const rules = await rulesIn("each-keyed", "{#each items as item (item.id)}");
    assert.ok(!rules.has("unkeyed-each"));
  });

  it("finds no issues in an idiomatic Svelte 5 component", async () => {
    const issues = await issuesIn(
      "clean",
      [
        "<script>",
        "  let { items, onselect } = $props();",
        "  let query = $state('');",
        "  const shown = $derived(items.filter((i) => i.name.includes(query)));",
        "</script>",
        "",
        "<input bind:value={query} />",
        "{#each shown as item (item.id)}",
        "  <button onclick={() => onselect(item)}>{item.name}</button>",
        "{/each}",
      ].join("\n"),
    );
    assert.deepEqual(issues, []);
  });
});

describe("checkFile — issue shape", () => {
  it("reports a 1-based line number and a path relative to the base directory", async () => {
    const root = fixture("check-shape", {
      "src/lib/Old.svelte": ["<script>", "  export let name;", "</script>"].join("\n"),
    });

    const issues = await checkFile(join(root, "src", "lib", "Old.svelte"), root);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].line, 2);
    assert.equal(issues[0].file, join("src", "lib", "Old.svelte"));
    assert.equal(issues[0].rule, "export-let");
    assert.ok(issues[0].fix.includes("$props()"));
  });

  it("reports every rule a single line triggers", async () => {
    const issues = await issuesIn("multi", "export let name; // and $$props");
    assert.deepEqual(
      issues.map((i) => i.rule).sort(),
      ["dollar-props", "export-let"],
    );
    assert.ok(issues.every((i) => i.line === 1));
  });

  it("reports one issue per offending line", async () => {
    const issues = await issuesIn("repeat", ["export let a;", "export let b;"].join("\n"));
    assert.deepEqual(
      issues.map((i) => i.line),
      [1, 2],
    );
  });
});
