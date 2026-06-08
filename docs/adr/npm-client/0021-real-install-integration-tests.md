# ADR 0021: Integration tests must use real `npm install`

Status: Implemented (2026-05-24)
Date: 2026-05

> TL;DR: Integration tests drive real `npm-client.install()` (resolve→fetch→unpack→link→lockfile) against vendored offline tarball fixtures, never the live registry

## Context

`tests/integration/chalk.test.ts` and `express-style.test.ts` use in-memory mocks for package contents — neither exercises the real install + unpack + link + load path that `@riftydev/npm-client` must validate. So M9 acceptance ("npm install real packages works") is unprovable. A-027 flags this. Hitting `registry.npmjs.org` from CI is flaky; the mocks trade flakiness for irrelevance.

## Decision

Drive `@riftydev/npm-client.install()` against a vendored tarball registry.

- Fixture layout: `tests/integration/fixtures/registry/<name>/<version>/<name>-<version>.tgz` + a manifest JSON. A fixture loader serves these as if from a registry.
- `chalk.test.ts` calls `install({ name: 'chalk', version: '<pinned>' })` against fixtures, then asserts `import chalk from 'chalk'` works through the runtime loader.
- `express-style.test.ts` does the same for `express` (or a documented minimal Express-shape replacement if express's native deps block first pass).
- Fully offline; CI does not depend on public npm.
- Refresh: `tools/integration-fixtures/refresh.ts` downloads pinned versions from `registry.npmjs.org` into `tests/integration/fixtures/`. Manual step, not CI.
- Implementation deferred to M11 (fixture pinning/verification is its own setup work).

## Consequences

- M9 acceptance becomes provable via an offline, deterministic test.
- Install + link path runs on every CI run.
- Negative: fixture tarballs are committed binaries (git size). Pinned versions stay small (chalk, minimal express each a few KB).
- Negative: manual refresh needed when fixtures drift from the live registry.
- Follow-up: M11.

## Acceptance criteria for the deferred implementation

- [ ] `chalk.test.ts` installs the real `chalk` tarball from `tests/integration/fixtures/` and imports it through the runtime loader.
- [ ] `express-style.test.ts` installs `express` (or a documented minimal replacement) from fixtures and exercises a request/response cycle.
- [x] Both tests run offline (no CI network).
- [ ] `tools/integration-fixtures/refresh.ts` (or equivalent) exists and is documented in `docs/compat/`.

## Implementation notes (2026-05-24)

First slice landed in `tests/integration/real-install.test.ts`, driving the real `install()` pipeline (resolve → fetch → unpack → link → lockfile) against three zero-dep tarballs under `tests/integration/fixtures/registry/`:

- `picocolors-1.0.0.tgz` (2.4 KB)
- `ms-2.1.3.tgz` (2.9 KB)
- `kleur-4.1.5.tgz` (6.0 KB)

Per-package version manifests (`<name>.json`) plus a top-level `manifest.json` index sit alongside the tarballs. `dist.tarball` URLs are rewritten to synthetic `tarball:<name>-<version>` keys; `dist.integrity` uses the SHA-256 SRI computed at vendoring time (matches `computeIntegrity()` so the tarball cache keys cleanly). Upstream SHA-512 integrity is retained per manifest under `dist.upstreamIntegrity` for refresh-time verification.

`tests/integration/fixtures/local-registry.ts` reads the manifest at module load and exposes `makeLocalFetcher()` for `new RegistryClient({ baseUrl: 'packument:', fetch })`. Three tests cover: single-package install, multi-package install with lockfile assertions, and second-install lockfile + tarball-cache reuse (`calls.tarball === 0`).

Still open vs original acceptance: no `chalk`/`express` fixtures (not zero-dep) and no `tools/integration-fixtures/refresh.ts` — the manual `curl` + Node-script flow used here is documented in this ADR. Both follow-ups stay on the M11 backlog under REVIEW_ACTIONS A-027.
