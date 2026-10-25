# ADR 0397: Retire completed legacy migration receipts before catalog mutations

Status: Accepted
Date: 2026-09
Refines: ADR-0278, ADR-0279, ADR-0394

## Context

I8 new-ID application and Scratch Save change current catalog identity/membership.
A completed migration receipt cannot own that later state forever. Treating every
adopted ref as history immediately instead accepts corrupt old definition,
baseline and target data. Both failures reproduced with real persistence tests;
independent DEC-2/PR-4 evidence: docs/backlog/distribution/reference/workbench-snapshot-application-receipt-decision.md.

## Decision

1. Every remaining migration ref retains strict catalog/source/target proof,
   including adopted refs. Every pending-adoption catalog entry has an active
   ref; unrelated adopted catalog projects need no journal membership.
2. Before a subsequent catalog mutation, validate the whole current migration
   state, then durably remove only completed adopted refs from its existing
   journal. Keep the envelope, including an empty refs list. Update in-memory
   refs only after durability. No startup/completion-time retirement.
3. Retirement is completed-work bookkeeping before the new catalog transaction,
   never payload application or a catalog commit. Snapshot compatibility/conflict
   preflight precedes it. Pending sibling refs, source and index stay exact.
4. Failed retirement prevents transaction/claim/payload effects. Restore the exact
   prior journal through its existing writer/barrier; if restoration cannot be
   proved, fence owner admission until reopen recovery. No new store, lock or
   per-operation receipt synchronization.

Candidates: mirror every later catalog change into immortal migration refs —
duplicates authority; blanket history exemption — three corruption REDs;
startup retirement — breaks idempotent reopen bytes; completion retirement —
removes fault-recovery evidence before existing cleanup settles. Selected:
strict validation then bounded journal retirement at the next mutation.

## Fault matrix

| boundary | required outcome |
|---|---|
| adopted proof or pending sibling corrupt | reject before retirement; repeated open unchanged |
| quota/permission during retirement | no transaction or false result; exact journal restoration or fenced admission |
| crash around retirement durability | old validated or retired receipt; same catalog/project/claim, pending sibling retained |
| later apply/Save | current catalog owns identity/membership; completed migration cannot reject legitimate reopen |

Catalog commit/recovery, Save rebind, copy/promote/mark/source cleanup and final
legacy-index tombstone retain ADR-0279/0329/0278 semantics. No user scope changes.
