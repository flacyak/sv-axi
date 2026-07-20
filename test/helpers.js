import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { decode } from "@toon-format/toon";

/**
 * Shared fixtures and process helpers.
 *
 * Fixture projects are built under `test/.tmp/` rather than the system temp
 * directory: they stay inside the repo where they can be inspected after a
 * failure, and the leading dot keeps them invisible to the downward project
 * scan (which skips dot-directories), so one fixture never discovers another.
 */

const exec = promisify(execFile);

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BIN = join(REPO, "dist", "index.js");
const TMP = join(REPO, "test", ".tmp");

/**
 * Build a fixture tree at `test/.tmp/<name>`, replacing any previous run.
 * Every fixture gets a `.git` marker so the upward project search stops at
 * the fixture root instead of escaping into this repo.
 */
export function fixture(name, files = {}) {
  const root = join(TMP, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries({ ".git/HEAD": "ref: refs/heads/main\n", ...files })) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

/** A minimal SvelteKit project: config, package.json, and the given files. */
export function kitFixture(name, files = {}) {
  return fixture(name, {
    "package.json": JSON.stringify({
      name,
      devDependencies: { svelte: "^5.0.0", "@sveltejs/kit": "^2.0.0" },
    }),
    "svelte.config.js": "export default { kit: {} };\n",
    ...files,
  });
}

/** Run the built CLI and capture its exit code and streams. */
export async function runCli(args, cwd) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [BIN, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/** Parse CLI stdout back out of TOON, so tests assert on data, not substrings. */
export function toon(stdout) {
  return decode(stdout);
}
