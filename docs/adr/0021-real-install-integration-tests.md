# ADR 0021: Integration tests must use real `npm install`

Status: Accepted
Date: 2026-05

## Context

`tests/integration/chalk.test.ts` and `tests/integration/express-style.test.ts` use hand-rolled in-memory mocks for the package contents — neither test exercises the real install + unpack + link + load path that `@rifty/npm-client` is meant to validate. M9 acceptance ("npm install real packages works") is therefore not provable by the current integration tests.

REVIEW_ACTIONS entry A-027 calls this out. Hitting `registry.npmjs.org` directly from CI would be flaky; the existing mock approach trades flakiness for irrelevance.

## Decision

Switch integration tests to drive `@rifty/npm-client.install()` against a vendored tarball registry.

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
- [ ] Both tests run offline (no network in CI).
- [ ] `tools/integration-fixtures/refresh.ts` (or equivalent) exists and is documented in `docs/compat/`.
