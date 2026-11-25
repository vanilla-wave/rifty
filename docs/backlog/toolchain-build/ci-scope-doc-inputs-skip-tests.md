---
area: toolchain-build
status: draft
title: Docs-only CI scope skips tests that read the changed docs
created: 2026-11-25
why: a README-only diff skips every test lane, also the tests that read that README — #463 (README only) proved its packed-consumer.test.ts fix with no CI test run; #461 broke that test and main went red
sources: [PR #461, PR #463, CI runs 45697486091 45697539290 45697559045, ADR-0323]
code: [tools/checks/ci-change-scope.mjs, tools/checks/pr-check.mjs, packages/isolate-host/tests/packed-consumer.test.ts]
---

## Context

`isDocumentationOnlyPath` (`tools/checks/ci-change-scope.mjs`, ADR-0323 §2)
counts `docs/**`, `.agents/**`, `.claude/**` and the basenames `README.md(x)`,
`CHANGELOG.md`, `LICENSE`/`LICENSE.md`/`LICENSE.txt` (case-insensitive), `AGENTS.md`, `CLAUDE.md` and contributor/security
docs as documentation at any depth. A diff of only such paths skips
`unit-and-conformance`, `e2e-chromium`, `browser-unit-chromium`, `no-coi-chromium`
in CI, and every `SOURCE_LANES` task (`pr-check.mjs:28`, incl. `test:run`,
`test:parity`) in `pnpm pr:check` (`pr-check.mjs:82`, same predicate).
Unconditional in CI only: `pnpm test:docs-contract` (`ci.yml:74`),
`check:compat-drift`, lint, backlog/refs. `pr:check` has no `test:docs-contract`
task: locally a docs-only diff runs not even those tests (they live only in `test:run`).

ADR-0323 §3 already decided "the focused source↔compat/ADR contract tests remain
unconditional" (its Context: such guards lived inside the full unit run); the
list below is the gap in that decision's completeness, and `pr:check` does not
carry it out at all.

Observed: #461 changed `packages/isolate-host/README.md` (+ CHANGELOG, docs,
`tools/publishing/first-publish.sh`). Its local `pr:check` was green
(`test:run` picks tests by import graph; a README is no import). Run 45697486091 then failed
`unit-and-conformance (run)` on `packed-consumer.test.ts:37`
(`expect(readme).toContain('npm install /path/to/<tarball>')`); `main` red in
45697539290, 45697559045. #461 itself was code-affecting (the script) — merged
20 s after `ready_for_review` on the red draft-era gate, so it is a DoD breach,
not a classifier miss. The fix #463 changed the README only: its CI
classified it docs-only and skipped `unit-and-conformance`; `pr:check` printed
`docs-only: 21/21; skipped … test:run, test:parity`. The test was proven only by
a local `pnpm exec vitest run packages/isolate-host/tests/packed-consumer.test.ts`.
So a README-only PR that breaks this test passes both gates green.

Tests that read a docs-classified file of the repo and are **not** in
`test:docs-contract` (search: `git grep` in `*.test.*`/`*.spec.ts`/`tests/**` for
`README`/`CHANGELOG`/`LICENSE`/`AGENTS.md`/`CLAUDE.md`/`docs/`/`.claude`/`.agents`,
then for backlog `reference/` oracle paths, each hit read; virtual-FS names, fixture
strings and comments dropped; line = the path's line):

- `packages/isolate-host/tests/packed-consumer.test.ts:36,63` — package README (install line, `js` snippet)
- `packages/isolate-guest/tests/embedder.test.ts:78,309,336` — package README
- `packages/npm-client/src/linker-bin-claim-link-ingress.contract.test.ts:11` — `docs/public/compat/package-tooling.md`
- `packages/npm-client/src/package-bin-normalization.contract.test.ts:75` — same page
- `tests/integration/esbuild-declarations.test.ts:34` — `docs/public/compat/esbuild-js-api.md`
- `tools/checks/lightningcss-compat-matrix.test.ts:13,41` — `docs/public/compat/lightningcss.md`, `compat/README.md`
- `tools/checks/sass-compat-matrix.contract.test.ts:4` — `docs/public/compat/sass-embedded.md`
- backlog `reference/` oracles (under the `docs/` prefix):
  `package-bin-normalization.contract.test.ts:77` and
  `installer-package-bin-normalization.contract.test.ts:52` (npm-client,
  `npm-11-package-bin-normalization-probe-output.json`);
  `installer-override-npm-value.contract.test.ts:47`, `overrides-npm-value.contract.test.ts:45`
  (npm-client) and `tests/e2e/npm-override-bare-version.spec.ts:28`
  (`overrides-bare-version-spec-probe-output.json`);
  `packages/agent/src/typebox-tools.test.ts:3` (JSON import,
  `pi-0.85.1-typebox-tool-probe.json`);
  `tools/agent-bench/src/codex-observation.fault.test.ts:8`
  (`agent-eval-codex-execution-probe.json`);
  `tools/checks/client-bundle-budget.test.ts:8` (`client-bundle-budget-evidence.json`)

Already in `test:docs-contract`: `apps/playground/src/App.test.ts`,
`packages/service-worker/tests/preview-routing-docs.test.ts`,
`packages/ts-language-service/src/hard-ceil-source.test.ts`,
`tools/checks/esbuild-compat-matrix.test.ts`, `tests/integration/landing-static.test.ts`,
`tests/integration/prod-npm-registry-proxy.test.ts`. Not searched: tests
reaching a doc through a computed path (a helper, a glob); the list is a lower bound.

Neighbour, not a duplicate: `docs-only-ci-observable-acceptance.md` (observed
runs of the skip path itself).

## Question

Which rule closes "a docs-only diff skips a test that reads that doc"?

1. Such files are code inputs: the classifier treats a doc path some test reads
   as code-affecting (a maintained list or one derived from the tests) — the
   heavy gate runs for them.
2. Tests do not read docs: a test pins source behavior only; the doc's claims
   are generated from that source or checked by a doc gate outside the test
   lanes.
3. A separate light lane — ADR-0323 §3's status quo made complete: every test
   that reads a doc runs unconditionally, like `test:docs-contract` today (and
   in `pr:check` too). Option 1 changes §2; option 2 changes where §3's guards live.

Also open: whether `pr:check`'s import-graph selection must pick such tests on
a mixed diff (in #461 it did not).

## Challenge

<!-- Advisory premise challenge, fresh independent critic — README §Challenge. -->
