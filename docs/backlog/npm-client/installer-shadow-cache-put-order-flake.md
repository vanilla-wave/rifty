---
area: npm-client
status: draft
title: installer-shadow-recipe-v2 contract test asserts cross-package cache.puts ORDER — flakes under full-suite load
created: 2026-08-16
why: one order-sensitive assert intermittently fails pr:check test:run under load (observed 2026-08-16, twice), poisoning unrelated PR gates
user_story: As an agent running pr:check, I want deterministic gates, but installer-shadow-recipe-v2-embedded-source-authority.contract.test.ts ("fresh nested consumes the official embedded source without standalone acquisition") asserts the ORDER of cross-package cache.puts while concurrent tarball acquisition completes in load-dependent order
sources: [packages/npm-client/src/installer-shadow-recipe-v2-embedded-source-authority.contract.test.ts]
code: [packages/npm-client/src/installer-shadow-recipe-v2-embedded-source-authority.contract.test.ts]
---

## Context

Observed 2026-08-16 during #256 slice-2 Final+GREEN batteries: `pnpm
pr:check` test:run failed once on this test (~40 s under full-suite load,
two packages' `cache.puts` entries swapped), green 12/12 isolated and green
on the immediately-following pr:check of the SAME tree. A Final+GREEN
reviewer independently classified it: pure `LedgerVfs` memory harness, no
OpfsFsSync wiring — concurrent acquisition completion order is
load-timing-sensitive; the assert should be order-insensitive on the
cross-package axis (per-package order may stay exact). Fault class:
observable-order (test-side over-pin), not a product defect.

## Acceptance (sketch — settle at pickup)

The cross-package `cache.puts` assert becomes order-insensitive (set/multiset
equality, or grouped per package) while any genuinely-contractual per-package
ordering stays exact; the test is deterministic under `vitest run` with the
full suite loaded.
