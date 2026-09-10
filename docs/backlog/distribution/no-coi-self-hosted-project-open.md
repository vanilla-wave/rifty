---
area: distribution
status: ready
title: Apply dependency snapshots and open actual saved no-COI files
created: 2026-09-10
why: SDK lacks the published snapshot consumer and refuses saved activation based on installation proof
epic: no-coi-self-hosted-project
sources: [https://github.com/vanilla-wave/rifty/issues/327, docs/backlog/distribution/reference/no-coi-project-open-refine.md, ADR-0417]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/workbench/src/workers/no-coi-install-context.ts, packages/workbench/src/glue/dep-snapshot-application.ts]
---

## Context

Goal I3–I6. Current SDK has no artifact consumer; openInstallation requires a
trusted stamp and eagerly activates adapters. User rejected install-status
admission, including the proposed incomplete-install-required recovery. Exact
answer, native Node probe and independent decision check are in refine evidence.

## Reference contract

ADR-0417; Node v24.16.0 local-source/absent-dependency probe in
`docs/backlog/distribution/reference/no-coi-project-open-refine.md`.
Existing producer/archive, replay checks, generic conflict overlay and
`preparePackageEntryRuntime` remain semantic owners. API: ADR-0420.
Real ms 2.0.0 output is executed against native Node by the browser test's producer
fixture; packed acceptance uses pinned real Vite 7.3.6 and native npm lock.

## Acceptance

1. Packed producer → public SDK/copied Worker applies the archive and builds
   real Vite without browser registry/Eddy requests or dummy URLs. → I3
2. Public application validates required input (missing/corrupt/wrong identity,
   template/runtime compatibility and bounded size), including forced/same-ID
   application, without hidden network-install fallback. → I3, I5
3. Ordinary saved open ignores missing/pending/legacy install proof and
   missing/corrupt lock; local Node source remains runnable and absent dependency
   errors occur at use. Open neither rewrites files nor fetches artifacts. → I4
4. Valid saved adapter facts activate the real adapter; unusable facts grant no
   capability. Actual adapter corruption/missing bytes fail at use without
   blocking local source or readable saved state. → I4
5. Default payload conflicts fail before cache/payload mutation; force replaces
   targeted files/directories and replaced-directory descendants, preserving
   unrelated source/dependency paths. Repeated/same-ID apply fully validates. → I5
6. Explicit changed-artifact application updates dependencies; saved source edits
   survive and real Vite rebuilds. No freshness inference in ordinary open. → I4, I5
7. Application success follows actual writes/persistence. Native quota rejects;
   tab death during application leaves readable source/independent Node access,
   dependency failure at use and optional explicit reapply. No completion gate,
   automatic retry or rollback promise. → I6

## Fault matrix

- corrupt-input × source/application | reject without payload/cache mutation, force cannot bypass | no-coi-snapshot-application + existing helper validation suites → I3, I5
- unbounded-read × asset acquisition | existing 128MiB and stall bounds, visible failure | native oversized input + dep-snapshot/bounded-asset-fetch tests → I3
- poisoned-cache × replay | exact existing source/replay/runtime checks retained | dep-snapshot replay tests + public input pipeline → I3, I5
- torn-state × saved open | no install-status admission; local Node survives, dependency errors at use | no-coi-saved-access + packed invalid-lock → I4, I6
- corrupt-input × adapter facts/payload | no fake capability or eager open refusal | packed invalid-lock/interruption + entry-adapter-failure contracts → I4
- observable-order × default conflict | unchanged native tree before/after rejection | native same-ID/directory/changed-artifact cases → I5
- quota-perm-fail × application | operation rejects, ordinary access survives | native quota + packed Vite quota → I6
- torn-state × tab death | no false success, recreated page reads source, use fails, explicit force reapplies | native interrupted application + packed Vite interruption → I6
- concurrent-same-key × toolchain operation | existing Worker busy/resident owner retained | existing lifecycle tests and apply admission → ADR-0376, ADR-0417

## Challenge

challenge: 2026-09-11 — clear

Unchanged ready goal premise and ADR-0417. Existing shared application helper and
point-of-use adapter preparation remove the need for a second install protocol.

## Out of scope

Goal map exclusions. No changes to Workbench catalog transactions or rollback.

## Decisions

ready-verdict: 2026-09-11 — Contract+RED @ 5de9c1cfc34d7de865ca0a847dba8518098995a9

re-cut: 2026-09-11 — startup implementation is available; combine its remaining Final+GREEN verification with whole-goal acceptance, preserving all startup obligations and finding history — trace: none

- 2026-09-11 — ADR-0420 records public request shapes and shared application/adapter owners.
- 2026-09-11 — Contract+RED evidence: docs/backlog/distribution/reference/no-coi-self-hosted-project-open-evidence.md.
