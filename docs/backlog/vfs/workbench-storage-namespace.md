---
area: vfs
status: draft
title: Confine Workbench storage to a host-selected OPFS namespace
created: 2026-09-07
why: Workbench currently preloads the whole origin OPFS, including unrelated host files.
user_story: As the Tracker plugin-sandbox embedder, I want to confine workbench storage to a host-selected opfs namespace, but today workbench currently preloads the whole origin OPFS, including unrelated host files.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md]
code: [packages/vfs/src/sync-mirror.ts, packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs.ts, packages/workbench/src/workers/workbench-owner-storage.ts]
---

## Context

installOpfsFs binds both async and sync surfaces to the origin root; init
indexes/preloads every file. Add an opt-in Workbench storage namespace bounding
both reads and writes, including package caches, proof files and recovery state.
The user chose an empty newly selected namespace, no automatic migration; the
previous setting continues to expose previous projects. Reopening a namespace
must preserve its own existing contents rather than clearing it again.

Keep current default behavior for existing callers. This is storage addressing,
not a hostile-code security boundary or permission to run multiple owners.
Use real browser OPFS with unrelated host-file sentinels and two sequential
namespaces; preserve paired-surface coherence and the existing origin lease.
Invalid root selection must fail before effects; ADR owns path validation and
wiring. New namespace setup/reopen failures must not change other namespaces.

Scope and user decisions: goal I4. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Decisions

- 2026-09-07 — finding draft; observable scope is settled by goal I4; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
