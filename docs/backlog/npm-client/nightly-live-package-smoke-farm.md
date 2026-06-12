---
area: npm-client
status: parked
title: Nightly live-package smoke farm (install + require + one call for top-N pure-JS packages)
created: 2026-06-12
why: express demo norm — ~5-7 bugs per new real-package consumer; a farm turns per-consumer surprises into a pipeline feeding compat-matrix
sources: [ADR-0130, D-004, fullstack-demo feedback 2026-06-12]
code: [tests/integration, tools/shadow-registry]
---
## Context
Live opt-in tests exist but cover only express/vite/fullstack (`tests/integration/*-live*.opt-in.test.ts`, `RIFTY_LIVE_REGISTRY`). Proposal: matrix "install + require + one representative call" for top-N pure-JS packages by category (zod, dayjs, commander, nanoid, mime, debug, ms, semver, ...). Nightly CI job (network-gated) runs the matrix; results land in compat-matrix (`docs/public/compat/`). Green packages get pinned as shadow-registry fixtures + regression test — pattern already established (`npm-client/chalk-express-integration-fixtures`, integration tiers tier-0…tier-4). Related: `npm-client/live-registry-roundtrip-smoke` (one-off dev-proxy smoke; the farm generalizes it).

## Options / Next
1. Category list + per-package smoke snippet (keep trivial: require, one call, assert shape/no-throw — NOT feature coverage; depth belongs to integration tiers).
2. Nightly GitHub workflow with `RIFTY_LIVE_REGISTRY` — registry ratelimits/flakiness policy (retry vs mark-flaky), no secrets needed for public registry.
3. Result sink: append integration-tier rows for `pnpm compat:generate` (milestone-cadence regeneration per A-033 — nightly writes raw results, matrix picks them up at DoD cycle).
4. Green → pin tarball fixture in shadow-registry; red → file area backlog item (the bug pipeline this farm exists for).

Gate: pull after worker-realm harness + first template wave (feedback priority №1+№2); needs the nightly-CI decision made once.

## Reversibility
REVERSIBLE — tests + CI workflow, no package API. Package list + flakiness policy are the provisional calls this item records.
