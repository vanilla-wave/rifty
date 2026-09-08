# ADR 0404: Orphan retain pairs scratch replace so rollback restores the only copy

Status: Accepted
Date: 2026-09
Refines: ADR-0403, ADR-0279

> TL;DR: The scratch half of an orphan-retain catalog transaction is
> `replace`, not a waived `create`; replace's before-stage is the restore
> of the only copy.

## Context

ADR-0403 decided one compact staged catalog transaction:
`retain-orphan` plus `create` with the "target must not exist"
precondition waived for `scratch`. Failed preserve must restore exact
pre-state (orphan still at `projects/scratch`, no retained row, no fresh
Scratch). ADR-0279 `create` does not snapshot a before-stage; `replace`
does. A waived `create` would need a new rollback pairing to put the
orphan back.

## Decision

`createScratch` that detects an unjournaled orphan still runs one
ADR-0279 transaction. Mutations are:

1. `retain-orphan` — copy `scratch/tree` (no install claims) to the
   retain root;
2. `replace` of `scratch` — starter tree from the supplied definition.

No create-precondition waiver. Rollback of `retain-orphan` removes the
retain directory; rollback of `replace` restores scratch from its
before-stage. That is the failed-preserve restore.

This overrules only ADR-0403's `create` + waive clause. Detection,
`retainedOrphans` pointer, public list/read methods, fail-leaves-only-copy,
and no second journal stay.

Candidates: `replace` (selected; existing before-stage restore).
Waived `create` plus restore-from-retain-after-stage (killed: extra
rollback the contract is deliverable without). Two sequential
transactions (already killed in ADR-0403).

## Consequences

Failed preserve uses the same replace rollback as Save/reseed.
`createScratch` without an orphan still uses `create` when scratch is
absent on disk.
