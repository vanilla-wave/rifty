# ADR 0021: Integration tests must use real `npm install`

Status: Implemented (2026-05-24)
Date: 2026-05

## Context

`tests/integration/chalk.test.ts` and `tests/integration/express-style.test.ts` use hand-rolled in-memory mocks for the package contents — neither test exercises the real install + unpack + link + load path that `@riftydev/npm-client` is meant to validate. M9 acceptance ("npm install real packages works") is therefore not provable by the current integration tests.

REVIEW_ACTIONS entry A-027 calls this out. Hitting `registry.npmjs.org` directly from CI would be flaky; the existing mock approach trades flakiness for irrelevance.

## Decision

Switch integration tests to drive `@riftydev/npm-client.install()` against a vendored tarball registry.

- Fixture layout: `tests/integration/fixtures/registry/<name>/<version>/<name>-<version>.tgz` plus a manifest JSON. A small fixture loader serves these as if they came from a registry.
- `tests/integration/chalk.test.ts` calls `install({ name: 'chalk', version: '<pinned>' })` against the fixture registry, then asserts that `import chalk from 'chalk'` works through the runtime's module loader.
- `tests/integration/express-style.test.ts` does the same for `express` (or, if `express`'s native deps make this impractical at first pass, a documented minimal Express-shape replacement pinned in the fixture set).
- Tests stay fully offline. CI does not depend on the public npm registry.
- Fixture refresh process: a `tools/integration-fixtures/refresh.ts` script downloads the pinned versions from `registry.npmjs.org` and writes them under `tests/integration/fixtures/`. Refresh is a manual step, not a CI step.
- Implementation deferred to M11. Fixture pinning and verification are setup work on their own.

## Consequences

- M9's acceptance becomes provable by an offline, deterministic test.
- The install + link path gets exercised on every CI run.
- Negative: fixture tarballs are committed binaries — non-trivial in `git` size terms. Pinned versions stay small (chalk and a minimal express are each a few KB).
- Negative: a manual refresh step is needed when fixtures fall out of date with the live registry.
- Follow-up: M11.

## Acceptance criteria for the deferred implementation

- [ ] `tests/integration/chalk.test.ts` installs the real `chalk` package tarball from `tests/integration/fixtures/` and successfully imports it through the runtime loader.
- [ ] `tests/integration/express-style.test.ts` installs `express` (or a documented minimal replacement) from fixtures and exercises a request/response cycle.
- [x] Both tests run offline (no network in CI).
- [ ] `tools/integration-fixtures/refresh.ts` (or equivalent) exists and is documented in `docs/compat/`.

## Implementation notes (2026-05-24)

First slice landed in `tests/integration/real-install.test.ts`. It drives the real `install()` pipeline (resolve → fetch → unpack → link → lockfile) against three zero-dep tarballs vendored under `tests/integration/fixtures/registry/`:

- `picocolors-1.0.0.tgz` (2.4 KB)
- `ms-2.1.3.tgz` (2.9 KB)
- `kleur-4.1.5.tgz` (6.0 KB)

Per-package version manifests (`<name>.json`) plus a top-level `manifest.json` index sit alongside the tarballs. `dist.tarball` URLs are rewritten to synthetic `tarball:<name>-<version>` keys; the `dist.integrity` field uses the SHA-256 SRI computed at vendoring time (matches `computeIntegrity()` so the tarball cache keys cleanly). The upstream SHA-512 integrity from the live registry is retained in each manifest under `dist.upstreamIntegrity` for refresh-time verification.

`tests/integration/fixtures/local-registry.ts` reads the manifest at module load and exposes `makeLocalFetcher()` for `new RegistryClient({ baseUrl: 'packument:', fetch })`. Three tests cover: single-package install, multi-package install with lockfile assertions, and second-install lockfile + tarball-cache reuse (`calls.tarball === 0`).

Open against the original acceptance: still no `chalk`/`express` fixtures (they aren't zero-dep) and no `tools/integration-fixtures/refresh.ts` script — the manual `curl` + Node-script flow used here is documented in this ADR. Both follow-ups remain on the M11 backlog under REVIEW_ACTIONS A-027.
