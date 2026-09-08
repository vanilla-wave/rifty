---
area: distribution
status: ready
title: Reject no-COI install and build when OPFS persistence fails
created: 2026-09-08
why: The toolchain worker ignores the flush failure report and acknowledges an install whose lockfile did not persist.
epic: no-coi-persisted-warm-open
sources: [docs/backlog/epics/no-coi-persisted-warm-open/goal.md, docs/backlog/distribution/reference/issue319-refine-evidence.md]
code: [packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/vfs/src/opfs-sync.ts]
---

## Context

Goal I3, observed defect: `flushMirror()` casts the real persistence report to
`Promise<void>`. The executed no-COI Chromium/OPFS probe injects native
`QuotaExceededError` for `/quota/package-lock.json`; install resolves while
`flush()` reports `total: 1`. `runInstalledBin()` also awaits `flushMirror()`
before acknowledging completion; that build path is a source finding, not an
executed fault proof. The linked research contains the reproducer and versions.

First PICKUP: reproduce the install defect as a discriminating RED, add the
real installed-bin/build fault case, and repair the existing flush-result
boundary. Memory and clean OPFS still complete normally. A report's sampled
failure list cannot replace its complete failure count. Surface storage failure
through the existing error settlement; do not add retry or another coordinator.

This unit delivers the reported-write-failure part of I3. Its unreadable-preload
part stays with `vfs/opfs-preload-failure-empty-bytes` and on the goal map;
neither successful flush nor this repair proves fresh readable content.

## Acceptance

1. Install and installed-bin completion reject reported persistence failure; clean and memory paths keep normal settlement. → I3

## Fault matrix

| Axis × operation | Outcome | Carrier |
| --- | --- | --- |
| quota-perm-fail × install/build flush | Reject, include native failure | tests/no-coi/no-coi-persistence.fault.spec.ts → I3 |

## Out of scope

Unreadable preload remains linked on the goal map; no crash-atomic persistence promise.

## Challenge

challenge: 2026-09-08 — clear; reuse goal’s unchanged I3 premise.

## Decisions

- 2026-09-08 — observed-defect RED: both native quota cases resolved on baseline; evidence in reference/issue319-implementation-evidence.md; RDY-8 baseline route.
- challenge: 2026-09-08 — clear; reuse goal's unchanged I3 premise.

- 2026-09-08 — FIT seeds an observed-defect draft from I3; PICKUP owns RED and implementation preparation, not another user-scope interview.
- 2026-09-08 — dedup: no existing no-COI flush-result repair item; the linked preload finding owns the distinct read-honesty boundary.
