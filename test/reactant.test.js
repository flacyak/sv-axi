import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeComponent } from "../dist/commands/reactant.js";

describe("analyzeComponent — props", () => {
  it("reads names out of a `$props()` destructuring", () => {
    const { props } = analyzeComponent(`
      <script>
        let { title, count = 0 } = $props();
      </script>
    `);
    assert.deepEqual(props, ["title", "count"]);
  });

  it("uses the source name of a renamed prop", () => {
    const { props } = analyzeComponent(`let { class: klass } = $props();`);
    assert.deepEqual(props, ["class"]);
  });

  it("reads `const { … } = $props()` as well as `let`", () => {
    const { props } = analyzeComponent(`const { href } = $props();`);
    assert.deepEqual(props, ["href"]);
  });

  it("reads legacy `export let` props", () => {
    const { props } = analyzeComponent(`
      <script>
        export let name;
        export let size = 'md';
      </script>
    `);
    assert.deepEqual(props, ["name", "size"]);
  });

  it("returns no props for a component that declares none", () => {
    const { props } = analyzeComponent(`<script>let n = $state(0);</script>`);
    assert.deepEqual(props, []);
  });
});

describe("analyzeComponent — change types", () => {
  /** The change types detected in `source`, as a set for order-free asserts. */
  const reactsIn = (source) => new Set(analyzeComponent(source).reacts);

  it("detects each rune", () => {
    assert.deepEqual(
      reactsIn(`
        let { a } = $props();
        let n = $state(0);
        let double = $derived(n * 2);
        $effect(() => console.log(n));
      `),
      new Set(["props", "state", "derived", "effect"]),
    );
  });

  it("detects rune sub-properties such as `$state.raw`", () => {
    assert.ok(reactsIn(`let x = $state.raw({});`).has("state"));
    assert.ok(reactsIn(`let y = $derived.by(() => 1);`).has("derived"));
    assert.ok(reactsIn(`$effect.pre(() => {});`).has("effect"));
  });

  it("detects `$bindable`", () => {
    const reacts = reactsIn(`let { value = $bindable() } = $props();`);
    assert.ok(reacts.has("bindable"));
    assert.ok(reacts.has("props"));
  });

  it("detects store usage by its import", () => {
    assert.ok(reactsIn(`import { writable } from "svelte/store";`).has("store"));
  });

  it("detects context usage", () => {
    assert.ok(reactsIn(`const theme = getContext('theme');`).has("context"));
    assert.ok(reactsIn(`setContext('theme', value);`).has("context"));
  });

  it("marks pre-runes patterns as legacy", () => {
    assert.ok(reactsIn(`export let name;`).has("legacy"));
    assert.ok(reactsIn(`$: doubled = count * 2;`).has("legacy"));
    assert.ok(reactsIn(`const dispatch = createEventDispatcher();`).has("legacy"));
  });

  it("does not mark a runes-only component as legacy", () => {
    const reacts = reactsIn(`let { a } = $props(); let n = $state(0);`);
    assert.ok(!reacts.has("legacy"));
  });

  it("counts `export let` as both props and legacy", () => {
    const reacts = reactsIn(`export let name;`);
    assert.ok(reacts.has("props"));
    assert.ok(reacts.has("legacy"));
  });

  it("returns nothing for a component with no reactivity", () => {
    assert.deepEqual(analyzeComponent(`<p>static markup</p>`).reacts, []);
  });
});
