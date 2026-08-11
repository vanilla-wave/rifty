# Publishing rifty packages

How `@riftydev/*` packages are built and released to npm. Rationale: **ADR-0070** (build + dual exports), **ADR-0071** (umbrella `@riftydev/sdk`).

## Model: dev-src / publish-dist

Each publishable package exposes two views of its entry points:

- **In-repo** (`main`/`module`/`types`/`exports`) → `./src/*.ts`. Vite, Vitest, and workspace consumers import raw TypeScript — no build, HMR works.
- **Published** (`publishConfig.{main,module,types,exports}`) → `./dist/*`. pnpm applies `publishConfig` overrides **only to the published manifest**, so the tarball points at built `dist/` (ESM `.js` + bundled `.d.ts`).

Build is `tsup` (`pnpm build:libs`). First-party `@riftydev/*` and external deps stay external (not re-bundled), so installing several `@riftydev/*` packages at the same version shares one copy of kernel/vfs singletons.

## Publishable set (16 packages)

- `packages/*` (14, including the umbrella front door **`@riftydev/sdk`** — ADR-0071)
- `@riftydev/shadow-registry` (in `tools/`, a runtime dep of `@riftydev/npm-client`)
- `@riftydev/eddy` (in `services/`, the opt-in fast-install resolver service — ADR-0182; hand-authored build, see below)

`apps/playground`, all test fixtures, and the workspace root `rifty-workspace` stay `private`. All 16 published packages are under the `@riftydev` scope (the unscoped `rifty` name was blocked by npm as too similar to existing packages, so the umbrella ships as `@riftydev/sdk`).

## Single source of truth

`tools/publishing/sync-publish-config.mjs` (`pnpm sync:publish`) regenerates every `packages/*` + `@riftydev/shadow-registry` publish block + `tsup.config.ts` from one SPEC. Edit it when you add a package, change `sideEffects`, add a subpath export, or bump the baseline version. **`@riftydev/eddy` is the exception**: it's a service with a `bin` CLI entry (not a library subpath), so its `package.json` + `tsup.config.ts` are hand-authored and live outside the SPEC — `sync:publish` doesn't touch it (ADR-0182).

## Local dry-run (no network)

```bash
pnpm install
pnpm build:libs                                   # produce dist/
pnpm --filter @riftydev/vfs pack --pack-destination /tmp/rifty   # inspect a tarball
tar -tzf /tmp/rifty/rifty-vfs-0.1.0.tgz           # dist/ + package.json + README + CHANGELOG (+ LICENSE on release)
```

CI's `lint-and-typecheck` job runs `pnpm build:libs` on every PR, so the publish build can't silently rot.

## Releasing (automated, on a tag) — tokenless OIDC

`.github/workflows/release.yml` triggers on a `v*` tag, rejects anything except stable SemVer `vX.Y.Z`, then: installs → sets every package version to the tag → `pnpm build:libs` → copies `LICENSE` into each package → `pnpm publish` filtered to **`./packages/*` + `@riftydev/shadow-registry` + `@riftydev/eddy` only** with `--access public --no-git-checks --provenance`. pnpm rewrites `workspace:*` to the tag version (at pack time, *before* the auth handshake) and applies each `publishConfig`.

**No NPM_TOKEN.** Auth is **npm OIDC trusted publishing**: with `id-token: write`, pnpm mints a short-lived token from GitHub's OIDC and publishes with build provenance — no long-lived secret in the repo. The bootstrap below makes that work.

> ⚠️ Never run a bare `pnpm -r publish`: the workspace also contains non-`private` integration fixtures (`tools/integration-fixtures/*`) that must never reach npm. Always use the scoped filter above.

`@riftydev/eddy` joined the automated set after its one-time token bootstrap and trusted-publisher setup. Tagged releases now ship all 16 names tokenlessly.

### Tooling-version floor (do not regress)

Tokenless OIDC has exact minimums, all satisfied by the repo + workflow:

| Tool | Floor | Notes |
|---|---|---|
| pnpm | **≥ 11.1.3** | Pinned **`pnpm@11.5.2`** via `packageManager`; `11.0.x` (old `11.0.8` pin) 404s on OIDC publish ([pnpm#11513]). CI reads the version from `packageManager`. |
| npm CLI | **≥ 11.5.1** | GitHub runners ship older, so `release.yml` runs `npm install -g npm@latest`. |
| Node | **≥ 24.0.0** | `engines` floor; `node-version: 24` resolves to it (≥ npm OIDC's 22.14.0). |

setup-node uses **no `registry-url`** (it would write an `${NODE_AUTH_TOKEN}` placeholder `.npmrc` that fights the OIDC fallback) and **no `NODE_AUTH_TOKEN`**.

```bash
# cut a release once the one-time setup below is done:
git tag vX.Y.Z
git push origin vX.Y.Z        # → release.yml builds & publishes all 16 packages, tokenless
```

## One-time setup (out of repo) — two phases

OIDC trusted publishing **cannot create a brand-new package name** (npm has nothing to attach the trust policy to — [npm/cli#8544]), and there is **no scope/org-level** trusted-publisher setting — it's strictly per-package. So the *first* publish of each name needs a token; every release after that is tokenless.

### Phase 0 — claim the names

Create the **`@riftydev` org** on npmjs.com (free for public packages) so the scope is yours. All published packages are scoped to `@riftydev` (umbrella is `@riftydev/sdk`). If the scope is taken, rename: change `name` in each `package.json`, the SPEC keys + `REPO_URL` in `tools/publishing/sync-publish-config.mjs`, then `pnpm sync:publish`.

### Phase 1 — bootstrap-publish each name ONCE with a token

The current 16-name `@riftydev` set is already bootstrapped. Do not rerun the
unfiltered command against the live scope; this is the fresh-scope procedure,
and `--only` is for a future new name.

No CI secret needed. Since the names don't exist yet, a granular token can't pre-select them — create a short-lived **granular token** with **All packages + Read and write + Bypass 2FA** (npm removed classic/automation tokens in Nov 2025; bypass-2FA is required for the non-interactive script). Put it in `$NPM_TOKEN` and run:

```bash
pnpm install
NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh --dry-run   # packs all 16, publishes nothing
NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh             # the real publish
```

To bootstrap a **single new name later**, scope it with `--only` so the existing names aren't re-published:

```bash
NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh --only @riftydev/new-package --dry-run
NPM_TOKEN=<granular-token> bash tools/publishing/first-publish.sh --only @riftydev/new-package
```

The script runs `build:libs`, bundles `LICENSE` into each package, and publishes the filtered set (`./packages/*` + `@riftydev/shadow-registry` + `@riftydev/eddy`, `--access public`; or just `--only`'s filter). The token is read from `$NPM_TOKEN` and **never written to disk** — a throwaway npmrc holds the literal `${NPM_TOKEN}` placeholder that pnpm interpolates at read time, and it (plus the `LICENSE` copies) is removed on exit. Equivalent manual form:

```bash
pnpm build:libs
for d in packages/*/ tools/shadow-registry/ services/eddy/; do cp LICENSE "$d/LICENSE"; done
# auth via `npm login` or ~/.npmrc //registry.npmjs.org/:_authToken=..., then:
pnpm -r --filter "./packages/*" --filter "@riftydev/shadow-registry" --filter "@riftydev/eddy" \
  publish --access public --no-git-checks   # --access public is mandatory for @riftydev/*
```

All 16 names now exist on the registry. Revoke the token after Phase 2.

### Phase 2 — add a GitHub Actions trusted publisher to EACH package

On npmjs.com, for **each** published package → **Settings → Trusted Publisher → GitHub Actions**, fill (all **case-sensitive**; npm validates only at publish time):

| Field | Value |
|---|---|
| Organization or user | `vanilla-wave` |
| Repository | `rifty` (name only, **not** `vanilla-wave/rifty`) |
| Workflow filename | `release.yml` (filename only, with extension) |
| Environment | *(leave empty)* |
| Allowed actions | tick **npm publish** |

To skip the per-package toil: `bash tools/publishing/setup-trusted-publishers.sh` — idempotent, covers all 16 names via `npm trust github` (npm ≥ 11.15.0); `--only <name>` scopes a rerun. **Tokens don't work for trust ops** (granular + Bypass 2FA → 403, per npm docs) — the script needs an interactive `npm login` session; on the first browser 2FA prompt tick **"skip 2FA for 5 minutes"** and the rest of the loop passes silently. The package must already exist either way (Phase 1).

### After that

Every `git push origin vX.Y.Z` publishes all 16 packages tokenlessly via OIDC with provenance. **The repo must stay PUBLIC** — provenance silently emits nothing for a private repo.

A `404`/`ENEEDAUTH` at publish almost always means: a trusted-publisher field typo (owner / repo-name-only / workflow-filename / environment case), a missing `id-token: write`, a stray `NODE_AUTH_TOKEN`, or pnpm pinned below 11.1.3.

[pnpm#11513]: https://github.com/pnpm/pnpm/issues/11513
[npm/cli#8544]: https://github.com/npm/cli/issues/8544
