---
area: distribution
status: ready
title: Bake dependency snapshots through a published producer
created: 2026-09-07
why: A host cannot bake its dependency snapshot in its own CI using only installed rifty packages.
user_story: As the Tracker plugin-sandbox embedder, I want to bake a browsable dependency archive in my own CI, but today a host cannot bake its dependency snapshot in its own CI using only installed rifty packages.
epic: self-hosted-snapshot-workbench
blocked_by: [distribution/dep-snapshot-tar]
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md]
code: [packages/workbench/src/dep-snapshot.ts, packages/workbench/src/glue/dep-snapshot.ts, packages/workbench/src/workbench/public.ts]
---

## Context

I1 remainder after `distribution/dep-snapshot-tar`. Caller package.json +
package-lock.json and a configured registry must produce a standard tar.gz,
snapshotId and install-artifact identity without a checkout. A packed consumer
restores through the same public entry, including raw gzip and HTTP-decoded tar.
Pinned lock must not silently resolve newer versions. Existing unsupported
package gates stay visible. Reference: `reference/dep-snapshot-producer-evidence.md`.

## User scenario

Host CI calls `produceDepSnapshot` from `@riftydev/workbench/dep-snapshot` with
its Vite `package.json`, npm lockfile and `RegistryClient`. Ordinary tar lists
payload/control files. A packed consumer restores those bytes through the same
entry with zero checkout imports.

## Acceptance

1. Published `@riftydev/workbench/dep-snapshot` `produceDepSnapshot` writes caller manifest+lock, runs existing install, emits ADR-0386 tar plus `snapshotId` and `installArtifactIdentity`; packed consumer imports only that entry and restores matching project bytes. `dep-snapshot-producer.test.ts` public-entry and packed-restore cases. → I1
2. A lock that pins older versions keeps those versions when the registry also advertises newer ones; produce does not live-resolve covered pins. `dep-snapshot-producer.test.ts` lock-pin case. → I1
3. Raw gzip and HTTP-decoded tar of the produced archive restore the same bytes through public fetch/restore. `dep-snapshot-producer.test.ts` wire cases. → I1

## Fault matrix

- Corrupt/unsupported input × produce: unparseable lock, lifecycle scripts and native/unsupported specs throw the existing installer errors before a snapshot is emitted. `dep-snapshot-producer.test.ts` gate cases. → I1
- Snapshot identity/replay × restore: produced `snapshotId` mismatch and altered replay closure reject before destination mutation. Existing tar/v3 identity carriers plus producer identity case. → I1
- Cancelled registry × produce: caller AbortSignal fails before destination snapshot bytes are returned. `dep-snapshot-producer.test.ts` abort case. → I1

## Out of scope

Builder-owned registry authentication, arbitrary installed-tree import,
application policy, snapshot-only admission and runtime asset closure remain
named sibling units.

## Decisions

ready-verdict: 2026-09-08 — Contract+RED @ b73743af58921a5d2ff161300599c4e6bee5bbc0
- 2026-09-08 — Final+GREEN PASS @ 067f1f9654b15742f7f4008f569a739aa8f17f66; packed produce/restore from an installed tarball remains an I1 goal residual.

- re-cut: 2026-09-08 — distribution/dep-snapshot-tar owns codec proof first; this unit retains public producer and packed-consumer I1 proof — trace: none
- 2026-09-07 — F1 user decision: builder-owned registry authentication excluded; host environment provides access.
- 2026-09-07 — user: producer-generated tar.gz, ordinary inspection, disjoint user/control paths; arbitrary caller-created installed trees are not admitted.
- 2026-09-08 — ADR-0389: sealed `@riftydev/workbench/dep-snapshot`; Memory VFS stays inside produce; existing install() is the bake owner.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
