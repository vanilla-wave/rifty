---
area: playground
status: draft
title: Retain downloadable orphan Scratch bytes while opening a fresh Scratch
created: 2026-09-07
why: An unjournaled Scratch tree blocks catalog creation with no public recovery path.
user_story: As the Tracker plugin-sandbox embedder, I want to retain downloadable orphan scratch bytes while opening a fresh scratch, but today an unjournaled Scratch tree blocks catalog creation with no public recovery path.
epic: self-hosted-snapshot-workbench
blocked_by: [vfs/workbench-storage-namespace]
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md]
code: [packages/workbench/src/workers/playground-project-authority.ts, packages/workbench/src/workbench/playground.ts, packages/workbench/src/workers/playground-project-catalog.contract.test.ts]
---

## Context

A real Chromium probe creates Scratch/tree/user.txt without catalog or journal,
then public Workbench boot rejects `Catalog mutation target already exists:
scratch`. Normal journaled crash recovery already has passing fault tests; the
cause of the report's unjournaled state is not established.

User choice: retain the orphan's bytes for enumeration/download via public API
and open fresh Scratch, without treating the old tree as a runnable project.
Downloads retain relative paths and exact ordinary bytes, including build output
and dependency files; internal trust claims are not admitted as restored trust.
Retained data survives close/reopen and stays in the selected namespace. No
automatic retention eviction/deletion. If preservation fails (quota, permission,
interruption), leave the only copy intact and surface the failure; do not claim
fresh Scratch/recovery success. A failed download remains retryable without
consuming the saved bytes.

The existing catalog transaction owner must remain the mutation authority.
Carrier/API/metadata choices belong to an ADR citing ADR-0279, with Class-kill
before any extra journal. Prove preserve → fresh boot → download → reload in
real OPFS, plus interruptions at the new persistent transitions.

Scope and user decisions: goal I6. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Decisions

- 2026-09-07 — finding draft; observable scope is settled by goal I6; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
