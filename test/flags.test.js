import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFlags } from "../dist/flags.js";

const SPECS = [
  { name: "cwd", takesValue: true },
  { name: "limit", takesValue: true, default: "200" },
  { name: "full", takesValue: false },
];

describe("parseFlags", () => {
  it("applies declared defaults", () => {
    const parsed = parseFlags([], SPECS);
    assert.deepEqual(parsed.flags, { limit: "200" });
    assert.deepEqual(parsed.positionals, []);
  });

  it("reads `--flag value`", () => {
    const parsed = parseFlags(["--cwd", "apps/web"], SPECS);
    assert.equal(parsed.flags.cwd, "apps/web");
  });

  it("reads `--flag=value`", () => {
    const parsed = parseFlags(["--cwd=apps/web"], SPECS);
    assert.equal(parsed.flags.cwd, "apps/web");
  });

  it("reads `--flag=` as an empty value rather than consuming the next arg", () => {
    const parsed = parseFlags(["--cwd=", "src/App.svelte"], SPECS);
    assert.equal(parsed.flags.cwd, "");
    assert.deepEqual(parsed.positionals, ["src/App.svelte"]);
  });

  it("sets valueless flags to true", () => {
    const parsed = parseFlags(["--full"], SPECS);
    assert.equal(parsed.flags.full, true);
  });

  it("overrides a default when the flag is given", () => {
    const parsed = parseFlags(["--limit", "5"], SPECS);
    assert.equal(parsed.flags.limit, "5");
  });

  it("collects positionals in order", () => {
    const parsed = parseFlags(["a.svelte", "--limit", "5", "b.svelte"], SPECS);
    assert.deepEqual(parsed.positionals, ["a.svelte", "b.svelte"]);
    assert.equal(parsed.flags.limit, "5");
  });

  it("treats everything after `--` as positional", () => {
    const parsed = parseFlags(["--", "--cwd", "-x"], SPECS);
    assert.deepEqual(parsed.positionals, ["--cwd", "-x"]);
    assert.equal(parsed.flags.cwd, undefined);
  });

  it("reports an unknown long flag instead of dropping it", () => {
    const parsed = parseFlags(["--stat"], SPECS);
    assert.equal(parsed.unknown, "--stat");
  });

  it("reports an unknown short flag", () => {
    const parsed = parseFlags(["-x"], SPECS);
    assert.equal(parsed.unknown, "-x");
  });

  it("reports a known flag given without its value", () => {
    const parsed = parseFlags(["--cwd"], SPECS);
    assert.equal(parsed.error, "flag --cwd requires a value");
    assert.equal(parsed.unknown, undefined);
  });

  it("accepts a bare `-` as a positional", () => {
    const parsed = parseFlags(["-"], SPECS);
    assert.deepEqual(parsed.positionals, ["-"]);
    assert.equal(parsed.unknown, undefined);
  });

  it("lets a later occurrence win", () => {
    const parsed = parseFlags(["--limit", "5", "--limit=9"], SPECS);
    assert.equal(parsed.flags.limit, "9");
  });
});
