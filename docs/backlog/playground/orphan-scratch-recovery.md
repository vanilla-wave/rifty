---
area: playground
status: ready
title: Retain downloadable orphan Scratch bytes while opening a fresh Scratch
created: 2026-09-07
why: An unjournaled Scratch tree blocks catalog creation with no public recovery path.
user_story: As the Tracker plugin-sandbox embedder, I want to retain downloadable orphan scratch bytes while opening a fresh scratch, but today an unjournaled Scratch tree blocks catalog creation with no public recovery path.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, docs/backlog/playground/reference/orphan-scratch-recovery-evidence.md, ADR-0403, ADR-0279, ADR-0401]
code: [packages/workbench/src/workers/playground-project-authority.ts, packages/workbench/src/workbench/playground.ts, packages/workbench/src/workbench/internal/playground-project-catalog.ts, packages/workbench/src/workbench/workbench-browser-owner.ts, packages/workbench/src/workbench/internal/playground-owner-protocol.ts]
---

## Context

A real Chromium probe creates Scratch/tree/user.txt without catalog or journal,
then public Workbench boot rejects `Catalog mutation target already exists:
scratch`. Evidence: `reference/orphan-scratch-recovery-evidence.md`. Normal
journaled crash recovery already has passing fault tests; this unit is the
unjournaled leftover only.

## User scenario

The embedder opens Workbench (optionally with `storage.namespace`) on a
bound OPFS root that already has
`/.rifty/workbench/v1/projects/scratch/tree/user.txt` bytes `orphan bytes`
and no catalog Scratch row or owning journal. `catalog.createScratch` opens
a fresh starter Scratch. `catalog.listRetainedOrphans` /
`listRetainedOrphanEntries` / `readRetainedOrphanFile` expose that tree for
download at relative path `user.txt` with the same bytes. Close and reopen
on the same storage setting still lists and reads those bytes. A failed
preserve leaves the only copy at `projects/scratch` and does not claim a
fresh Scratch. A failed download can be retried; saved bytes stay.

## Acceptance

1. `createScratch` on an unjournaled `projects/scratch` tree (no catalog
   Scratch, no journal) succeeds and publishes a fresh catalog Scratch from
   the supplied definition; the live Scratch tree does not contain the
   orphan's `user.txt` bytes. `playground-orphan-scratch-recovery.contract.test.ts`
   planted-orphan create case. → I6 → scenario
2. After that create, `listRetainedOrphans` has one `orphan-scratch-*` row
   and `readRetainedOrphanFile(id, 'user.txt')` returns exact `orphan bytes`;
   nested and `node_modules` paths keep relative paths and exact ordinary
   bytes. Same contract file download case. → I6 → ADR-0403
3. Empty catalog exposes the three retain methods: `listRetainedOrphans()`
   is `[]`; reads of an unknown id throw without creating files. Same
   contract file empty-catalog case. → I6 → ADR-0403
4. Close and reopen the catalog authority on the same VFS: retained rows and
   file bytes are unchanged. Same contract file reopen case. → I6 → scenario
5. A second `readRetainedOrphanFile` after a thrown missing-path read still
   returns the saved bytes; retain files are not deleted. Same contract file
   retry case. → I6 → ADR-0403
6. Preserve → fresh boot → download → reload on real OPFS, including a
   selected `storage.namespace` (retained bytes stay under that directory,
   not as origin-root siblings).
   `tests/browser-unit/orphan-scratch-recovery.spec.ts`. → I6 → scenario → ADR-0401

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| torn-state × preserve | pre-commit fail restores orphan at `projects/scratch`; no retained catalog row; no fresh Scratch snapshot | `playground-orphan-scratch-recovery.fault.test.ts` persist-fail case | → I6 → ADR-0403 |
| quota-perm-fail × preserve | loud quota/permission throw (not `already exists`); only copy intact | same fault file quota and permission cases | → I6 → ADR-0403 |
| crash/reload × retain+reopen | committed retain+fresh Scratch survive a new authority on the same tree | contract reopen case plus browser-unit reload | → I6 |

## Out of scope

Adopting the orphan as a runnable catalog project. Deleting or evicting
retained bytes automatically. A recovery UI. Journaled catalog leftovers
(existing ADR-0279 recovery). Hostile-code sandboxing. Browser eviction
guarantees. Changing `snapshot()` keys. Preview prefix (I5). Operation
budgets (I7).

## Decisions

- 2026-09-09 — ADR-0403: detect on createScratch; one staged retain-orphan+create transaction; catalog.retainedOrphans pointer; public list/read methods; fail leaves only copy; no second journal.
- 2026-09-07 — finding draft; observable scope is settled by goal I6; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-09 — clear
