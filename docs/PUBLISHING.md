# Publishing rifty packages

How the `@rifty/*` packages are built and released to npm. Rationale: **ADR-0069**.

## The model: dev-src / publish-dist

Each publishable package keeps two views of its entry points:

- **In-repo (`main`/`module`/`types`/`exports`) → `./src/*.ts`.** Vite, Vitest, and
  workspace consumers import raw TypeScript — no build step, HMR works.
- **Published (`publishConfig.{main,module,types,exports}`) → `./dist/*`.** pnpm
  applies `publishConfig` field overrides **only to the published manifest**, so the
  tarball points at the built `dist/` (ESM `.js` + bundled `.d.ts`).

The build is `tsup` (`pnpm build:libs`). First-party `@rifty/*` and external deps stay
external (not re-bundled), so installing several `@rifty/*` packages at the same
version shares one copy of kernel/vfs singletons.

## The publishable set (11 packages)

`packages/*` (10) **plus** `@rifty/shadow-registry` (in `tools/`, a runtime dep of
`@rifty/npm-client`). `apps/playground` and all test fixtures stay `private`.

## Single source of truth

`tools/publishing/sync-publish-config.mjs` (run `pnpm sync:publish`) regenerates every
package's publish block + `tsup.config.ts` from one SPEC. Edit it when you add a
package, change `sideEffects`, add a subpath export, or bump the baseline version.

## Local dry-run (no network)

```bash
pnpm install
pnpm build:libs                                   # produce dist/
pnpm --filter @rifty/vfs pack --pack-destination /tmp/rifty   # inspect a tarball
tar -tzf /tmp/rifty/rifty-vfs-0.1.0.tgz           # dist/ + package.json + README + CHANGELOG (+ LICENSE on release)
```

The CI `lint-and-typecheck` job runs `pnpm build:libs` on every PR, so the publish
build can't silently rot.

## Releasing (automated, on a tag)

`.github/workflows/release.yml` triggers on a `v*` tag and: installs → sets every
package version to the tag → `pnpm build:libs` → copies `LICENSE` into each package →
`pnpm publish` filtered to **`./packages/*` + `@rifty/shadow-registry` only** with
`--access public --no-git-checks --provenance`. pnpm rewrites `workspace:*` to the tag
version and applies each `publishConfig`.

> ⚠️ Never run a bare `pnpm -r publish`: the workspace also contains non-`private`
> integration fixtures (`tools/integration-fixtures/*`, vendored opencode packages
> under `tests/`) that must never reach npm. Always use the scoped filter above.

```bash
# cut a release once the manual setup below is done:
git tag v0.1.0
git push origin v0.1.0        # → release.yml builds & publishes all 11 packages
```

## One-time manual setup (out of repo)

These cannot live in the repo — do them once:

1. **Own the `@rifty` scope on npmjs.com.** Create the org/scope (or, if it's taken,
   rename the scope: change `name` in each `package.json`, the SPEC's keys, and the
   release filter). Without this, `pnpm publish --access public` 403s.
2. **Create an npm Automation access token** (npmjs.com → Access Tokens) with publish
   rights to the scope.
3. **Add it as the `NPM_TOKEN` GitHub repo secret** (Settings → Secrets and variables
   → Actions → New repository secret).
4. **Create the GitHub repo and push** (the repo is currently local-only). Set the
   real owner/name in `tools/publishing/sync-publish-config.mjs` (`REPO_URL`) and
   re-run `pnpm sync:publish` so `repository`/`homepage`/`bugs` and npm **provenance**
   point at the right repo. (Provenance also needs the repo public.)
5. Optionally `npm publish` once manually from a clean `pnpm build:libs` to claim the
   names before wiring CI.
