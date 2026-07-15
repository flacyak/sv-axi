#!/usr/bin/env node
// Tags HEAD (jj: @-) as v<package.json version> and pushes the tag to origin.
// Pushing the tag triggers .github/workflows/release.yml, which publishes to npm.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = `v${version}`;

const existing = run("git", ["tag", "--list", tag]);
if (existing) {
  console.error(`Tag ${tag} already exists. Bump the version first (npm run version:patch|minor|major), commit, then release.`);
  process.exit(1);
}

// Warn if the committed package.json differs from the working copy (bump not committed yet).
const committedVersion = JSON.parse(run("git", ["show", "HEAD:package.json"])).version;
if (committedVersion !== version) {
  console.error(`package.json at HEAD has version ${committedVersion}, working copy has ${version}.`);
  console.error("Commit the version bump first (jj commit / jj describe), then rerun.");
  process.exit(1);
}

run("git", ["tag", "-a", tag, "-m", tag, "HEAD"]);
console.log(`Created tag ${tag} on ${run("git", ["rev-parse", "--short", "HEAD"])}`);

execFileSync("git", ["push", "origin", tag], { stdio: "inherit" });
console.log(`Pushed ${tag} — the release workflow will publish sv-axi@${version} to npm.`);
