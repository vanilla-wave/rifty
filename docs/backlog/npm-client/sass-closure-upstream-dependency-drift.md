---
area: npm-client
status: draft
title: Sass closure lock breaks when a live semver range outruns the frozen fixture
created: 2026-08-07
why: sass-1.100.0 closure freezes readdirp@5.0.0 while its manifest range stays ^5.0.0; upstream readdirp@5.1.1 (2026-08-06) makes real resolution diverge, so CI-active browser-unit fails deterministically on all main content after that date.
user_story: As a developer whose PR CI runs after an upstream release inside the Sass closure's semver ranges, I want the exact-closure proof to stay green or fail with a named drift diagnosis, but today `sass-vite-contract.spec.ts` fails on content my PR never touched.
sources: [ADR-0188, docs/backlog/npm-client/reference/sass-1.100.0-packument.md, docs/backlog/npm-client/nightly-live-package-smoke-farm.md]
code: [tools/shadow-registry/src/fixtures/sass-1.100.0-closure.json, tools/shadow-registry/src/fixtures/sass-vite-7.3.6-package-lock.fixture, tests/browser-unit/sass-vite-contract.spec.ts]
---

## Context

`sass-1.100.0-closure.json` pins `readdirp` to `5.0.0`
(version/tarball/integrity) while the closure manifest keeps the live range
`^5.0.0`. `expectExactSassClosure`
(`tests/browser-unit/sass-vite-contract.spec.ts`, closure lock entry assertion)
compares the real npm resolution against the frozen entry.

Observed drift, reproducible:

- `npm view readdirp time` → `5.0.0: 2025-11-25T23:11:27Z`,
  `5.1.1: 2026-08-06T06:26:38Z`.
- CI browser-unit on PR #228 head `0c875d2d5` (content-identical to
  main + eval branch; sass files untouched) failed twice with the same
  `toEqual` diff: expected `readdirp@5.0.0` closure entry, received
  `5.1.1`/its tarball/integrity — runs 31130486091 (original + rerun).
- Last green main CI (`22961f0cf`) ran 2026-08-05, before the release.
- Instance closed on main: `0196de47d` refreshed the frozen closure to
  readdirp 5.1.1 (new vendored tarball, closure/node-build/package-lock
  fixtures, capsule tests) — a per-release refresh, not a class fix.

Every closure dependency held by a range, not just readdirp, carries the same
class: any upstream publish inside the range flips CI-active proofs red without
a repo change (fault class `frozen-assumption` × live-registry resolution).

## Options / Next

- Decide the recurring contract: keep refreshing the frozen closure on every
  upstream publish inside a range (as `0196de47d` did), freeze the registry
  input the CI-active proof resolves against, or make the proof name upstream
  drift loudly (distinct from a substitution defect) — needs the Sass
  substitution owner's fork resolution.
- Related detection cadence: `npm-client/nightly-live-package-smoke-farm`.
- Dedup note: no existing item covers frozen-closure drift; nearest are
  live-smoke coverage items (`live-registry-roundtrip-smoke`,
  `nightly-live-package-smoke-farm`) — different mechanism (coverage, not a
  broken frozen pin).

## Reversibility

Reversible — fixture/proof contract choice; no public API.
