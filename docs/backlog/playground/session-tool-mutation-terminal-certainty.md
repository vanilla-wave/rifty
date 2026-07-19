---
area: playground
status: draft
title: Session-tool mutations retain one terminal outcome across transport timeout
created: 2026-07-19
why: SCM and archive requests lose their page correlation at 60 seconds while the owner may still apply the operation, and duplicate request ids are rejected instead of replaying the terminal result
user_story: As a developer staging, committing, discarding, or importing a project under load, I want one exact result that survives a delayed response, but today an applied mutation can be shown as failed and a retry can conflict or duplicate intent.
epic: workbench-fault-honesty
blocked_by: []
sources: [PR-153-post-merge-audit, ADR-0278, fault-classes]
code: [apps/playground/src/workbench/internal/playground-session-tools-transport.ts, apps/playground/src/workers/playground-session-tools-owner.ts, apps/playground/src/workbench/internal/playground-session-tool-coordinator.ts]
---

## Context

The browser transport deletes a pending `requestId` when its fixed timeout fires and ignores any later owner response. The owner serializes requests and remembers only that an id was seen; it neither retains nor replays the terminal response. This affects admitted state changes — `scm:stage`, `scm:unstage`, `scm:discard`, `scm:commit`, and `archive:import` — where timeout does not prove the mutation was absent. Read-only refresh, diff, and export need bounded failure but do not share the duplicate-mutation risk.

## Refinement path

- Inventory operation semantics and split read deadlines from mutation terminal certainty; do not silently make every read unbounded.
- Define the semantic owner and bounded retention for exact request, terminal result/error, replay, cleanup, session close, and owner death. Retrying the same admitted intent must return the same terminal or reject unequal reuse; it must not execute twice.
- RED first for each mutation family: applied response delayed past timeout, response lost after apply, duplicate delivery before/after terminal, close during execution, and a late response after close. Assert exact Git/index/worktree/archive state and one visible result.
- Coordinate but do not merge with `owner-vfs-mutation-terminal-certainty`: these protocols have different authorities and result shapes. Persistence health after a terminal durability error stays in `workbench-persistence-health-propagation`.
