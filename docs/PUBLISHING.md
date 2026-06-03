# Publishing rifty packages

How the `@riftydev/*` packages are built and released to npm. Rationale: **ADR-0070**
(build + dual exports), **ADR-0071** (the umbrella `rifty`).

## The model: dev-src / publish-dist

Each publishable package keeps two views of its entry points:

- **In-repo (`main`/`module`/`types`/`exports`) → `./src/*.ts`.** Vite, Vitest, and
  workspace consumers import raw TypeScript — no build step, HMR works.
- **Published (`publishConfig.{main,module,types,exports}`) → `./dist/*`.** pnpm
  applies `publishConfig` field overrides **only to the published manifest**, so the
  tarball points at the built `dist/` (ESM `.js` + bundled `.d.ts`).

The build is `tsup` (`pnpm build:libs`). First-party `@riftydev/*` and external deps stay
external (not re-bundled), so installing several `@riftydev/*` packages at the same
version shares one copy of kernel/vfs singletons.

## The publishable set (12 packages)

`packages/*` (11, including the umbrella **`rifty`** front door — ADR-0071) **plus**
`@riftydev/shadow-registry` (in `tools/`, a runtime dep of `@riftydev/npm-client`).
`apps/playground` and all test fixtures stay `private`. The workspace root package is
`rifty-workspace` (private) — the bare name `rifty` belongs to the umbrella.

## Single source of truth

`tools/publishing/sync-publish-config.mjs` (run `pnpm sync:publish`) regenerates every
package's publish block + `tsup.config.ts` from one SPEC. Edit it when you add a
package, change `sideEffects`, add a subpath export, or bump the baseline version.

## Local dry-run (no network)

```bash
pnpm install
pnpm build:libs                                   # produce dist/
pnpm --filter @riftydev/vfs pack --pack-destination /tmp/rifty   # inspect a tarball
tar -tzf /tmp/rifty/rifty-vfs-0.1.0.tgz           # dist/ + package.json + README + CHANGELOG (+ LICENSE on release)
```

The CI `lint-and-typecheck` job runs `pnpm build:libs` on every PR, so the publish
build can't silently rot.

## Releasing (automated, on a tag) — tokenless OIDC

`.github/workflows/release.yml` triggers on a `v*` tag and: installs → sets every
package version to the tag → `pnpm build:libs` → copies `LICENSE` into each package →
`pnpm publish` filtered to **`./packages/*` + `@riftydev/shadow-registry` only** with
`--access public --no-git-checks --provenance`. pnpm rewrites `workspace:*` to the tag
version (at pack time, *before* the auth handshake) and applies each `publishConfig`.

**No NPM_TOKEN.** Auth is **npm OIDC trusted publishing**: with `id-token: write`,
pnpm mints a short-lived token from GitHub's OIDC and publishes with build
provenance — no long-lived secret lives in the repo. The bootstrap below is what
makes that work.

> ⚠️ Never run a bare `pnpm -r publish`: the workspace also contains non-`private`
> integration fixtures (`tools/integration-fixtures/*`, vendored opencode packages
> under `tests/`) that must never reach npm. Always use the scoped filter above.

### Tooling-version floor (do not regress)

Tokenless OIDC has exact minimums, all satisfied by the repo + workflow:

- **pnpm ≥ 11.1.3** — we pin **`pnpm@11.5.1`** via `packageManager`. pnpm `11.0.x`
  (the old `11.0.8` pin) is broken for OIDC publish — it 404s ([pnpm#11513]). The CI
  workflows read the version from `packageManager`, so bumping it is enough.
- **npm CLI ≥ 11.5.1** — GitHub runners ship older, so `release.yml` runs
  `npm install -g npm@latest`.
- **Node ≥ 22.14.0** — `node-version: 22` resolves to it.
- setup-node uses **no `registry-url`** (it would write an `${NODE_AUTH_TOKEN}`
  placeholder `.npmrc` that fights the OIDC fallback), and **no `NODE_AUTH_TOKEN`**.

```bash
# cut a release once the one-time setup below is done:
git tag v0.1.0
git push origin v0.1.0        # → release.yml builds & publishes all 12 packages, tokenless
```

## One-time setup (out of repo) — two phases

OIDC trusted publishing **cannot create a brand-new package name** (npm has nothing to
attach the trust policy to — [npm/cli#8544]), and there is **no scope/org-level**
trusted-publisher setting — it is strictly per-package. So the *first* publish of each
name needs a token; every release after that is tokenless.

### Phase 0 — claim the names

Create the **`@riftydev` org/scope** on npmjs.com. The unscoped **`rifty`** name is
claimed by its first publish (verified free 2026-06-02). If either is taken, rename:
change `name` in each `package.json`, the SPEC keys + `REPO_URL` in
`tools/publishing/sync-publish-config.mjs`, then `pnpm sync:publish`.

### Phase 1 — bootstrap-publish each name ONCE with a token

No CI secret needed. Create a short-lived **granular npm token** with publish rights
to **both** the `@riftydev` scope **and** the unscoped `rifty` name, put it in
`$NPM_TOKEN`, and run the bootstrap script:

```bash
pnpm install
NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh --dry-run   # packs all 12, publishes nothing
NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh             # the real publish
```

The script runs `build:libs`, bundles `LICENSE` into each package, and publishes the
filtered set (`./packages/*` + `@riftydev/shadow-registry`, `--access public`). The
token is read from `$NPM_TOKEN` and **never written to disk** — a throwaway npmrc holds
the literal `${NPM_TOKEN}` placeholder that pnpm interpolates at read time, and it (plus
the `LICENSE` copies) is removed on exit. Equivalent manual form:

```bash
pnpm build:libs
for d in packages/*/ tools/shadow-registry/; do cp LICENSE "$d/LICENSE"; done
# auth via `npm login` or ~/.npmrc //registry.npmjs.org/:_authToken=..., then:
pnpm -r --filter "./packages/*" --filter "@riftydev/shadow-registry" \
  publish --access public --no-git-checks   # --access public is mandatory for @riftydev/*
```

Every one of the 12 names now exists on the registry. Revoke the token after Phase 2.

### Phase 2 — add a GitHub Actions trusted publisher to EACH package

On npmjs.com, for **each** of the 12 packages → **Settings → Trusted Publisher →
GitHub Actions**, fill (all **case-sensitive**; npm validates only at publish time):

| Field | Value |
|---|---|
| Organization or user | `vanilla-wave` |
| Repository | `rifty` (name only, **not** `vanilla-wave/rifty`) |
| Workflow filename | `release.yml` (filename only, with extension) |
| Environment | *(leave empty)* |
| Allowed actions | tick **npm publish** |

To skip the 12× toil, use npm's **bulk trusted-publishing** config flow, or the
`npm trust github <pkg> --repo vanilla-wave/rifty --file release.yml --allow-publish`
CLI (npm ≥ 11.10.0; needs account 2FA + an interactive OTP). The package must already
exist either way (Phase 1).

### After that

Every `git push origin vX.Y.Z` publishes all 12 packages tokenlessly via OIDC with
provenance. **The repo must stay PUBLIC** — provenance silently emits nothing for a
private repo. A `404`/`ENEEDAUTH` at publish almost always means a trusted-publisher
field typo (owner / repo-name-only / workflow-filename / environment case), a missing
`id-token: write`, a stray `NODE_AUTH_TOKEN`, or pnpm pinned below 11.1.3.

[pnpm#11513]: https://github.com/pnpm/pnpm/issues/11513
[npm/cli#8544]: https://github.com/npm/cli/issues/8544
