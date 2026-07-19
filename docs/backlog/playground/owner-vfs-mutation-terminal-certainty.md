---
area: playground
status: draft
title: Owner VFS mutations retain one terminal outcome across transport timeout
created: 2026-07-19
why: the page drops a conditional VFS commit correlation at its ACK timeout, so a write can apply later while the editor has already received a definitive failure
user_story: As a developer saving a file under a slow owner, I want the save to converge to the exact committed or rejected result, but today the UI can report failure before a valid late terminal arrives.
epic: workbench-fault-honesty
blocked_by: []
sources: [PR-153-post-merge-audit, ADR-0273, fault-classes]
code: [apps/playground/src/glue/owner-vfs-client.ts, apps/playground/src/workers/owner-vfs-authority.ts, apps/playground/src/workbench/project-documents.ts]
---

## Context

`owner-vfs-client` admits a commit under an `operationId`, but its ACK timer calls `takeCommit()`, rejects the caller, and removes the only page correlation. The owner can still finish and publish a valid terminal; the page then ignores it as unknown while the owner terminal ledger retains it until cleanup. A user can therefore see “save failed” even though the bytes and tree revision advanced, then retry from a stale version and hit a conflict. This is `provenance-lie` plus `observable-order`, with an unknown mutation outcome at the page boundary.

## Refinement path

- Enumerate every conditional-commit caller and the exact owner ledger lifetime; one owner must retain operation identity, request equality, terminal receipt, and cleanup.
- Define finite outcomes for late success, late version conflict, owner-epoch change, disconnect, explicit close, replay, and operation-id reuse. A local deadline may change UI state, but cannot assert “not applied” after admission without owner proof.
- RED first: commit applies just after the current ACK deadline, response is lost then replayed, terminal arrives during close, and a new owner epoch rejects an old terminal. Pin exact bytes, version, tree revision, and one settlement.
- Keep storage durability in `fault-honest-opfs-persistence`; this item owns mutation terminal certainty, not whether acknowledged memory state has reached OPFS.
