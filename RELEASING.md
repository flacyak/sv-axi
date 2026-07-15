# Releasing sv-axi

Releases are tag-driven: pushing a `v*` tag makes GitHub Actions typecheck, build,
and publish to npm with provenance, then create a GitHub Release with generated notes.

## One-time setup

1. Create an npm [granular access token](https://www.npmjs.com/settings) with
   read/write access to the `sv-axi` package (or "all packages" before the first publish).
2. Add it to the GitHub repo as an Actions secret named `NPM_TOKEN`
   (`gh secret set NPM_TOKEN`).

## Cutting a release

```sh
npm run version:patch   # or version:minor / version:major — bumps package.json + lockfile only
jj commit -m "release: v0.1.1"
jj git push             # the release commit must be on GitHub before tagging
npm run release         # tags HEAD (@-) as vX.Y.Z and pushes the tag → CI publishes
```

The bump scripts use `--no-git-tag-version` on purpose: this repo is jj-colocated,
so committing stays in jj and only tagging touches git directly.

`npm run release` refuses to run if the tag already exists or if the version bump
hasn't been committed yet.

## Notes

- `prepublishOnly` runs typecheck + build, so a stale `dist/` can never be published
  (this also guards manual `npm publish`).
- The workflow fails if the tag doesn't match `package.json`'s version.
