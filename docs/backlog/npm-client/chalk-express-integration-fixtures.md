---
area: npm-client
status: active
title: Vendored chalk + full-express tarball fixtures + integration-fixtures refresh tool
created: 2026-06-08
why: ADR-0021 mandates offline vendored-tarball tests; picocolors/ms/kleur + diamond landed, chalk/express + refresh script still open
user_story: Dev wants `npm install chalk express` proven offline end-to-end, but only zero-dep tarballs vendored — multi-tarball chalk/express fixtures + the refresh pack tool don't exist yet.
sources: [A-027, ADR-0021, TASKS M9, large-targets-readiness-2026-05-27]
---
## Context
ADR-0021 requires offline vendored-tarball integration tests over mocks, so M9 "npm install real packages works" is provable. First slice landed: `tests/integration/real-install.test.ts` (picocolors/ms/kleur, zero-dep) via offline fake registry under `tests/integration/fixtures/registry/`. Nested-install diamond landed (`nested-install.test.ts`, real debug@4.4.1 + ms@2.1.3/2.0.0 + synth wrapper). Live express@4 runs opt-in (`express-live-run.opt-in.test.ts`). Still open: vendored `chalk` + full `express` fixtures (not zero-dep → multi-tarball), and `tools/integration-fixtures/refresh.ts` (manual `npm pack` flow only documented today at `tools/integration-fixtures/diamond-conflict-parent/README.md`).
## Options / Next
Vendor chalk + full-express tarball sets into the offline fixture registry (per the picocolors/ms/kleur precedent + manifest.json/per-pkg json/local-registry.ts Fetcher). Build `tools/integration-fixtures/refresh.ts` to automate the `npm pack`→vendor flow (replaces the manual README steps). Add real `install()` end-to-end cases for both, offline, CI-safe.
## Reversibility
Reversible — test fixtures + a tools/ script, no public API / cross-package surface. New tarball artifacts only (vendored, not deps). Express fixture is large (multi-pkg); refresh tool keeps it maintainable.
