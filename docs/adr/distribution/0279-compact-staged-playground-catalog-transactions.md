# ADR 0279: Compact staged Playground catalog transactions

Status: Accepted
Date: 2026-07
Refines: ADR-0165, ADR-0278

> TL;DR: Playground catalog mutations keep byte trees in derived VFS stages;
> the durable journal contains only bounded semantic metadata and the catalog
> pointer remains the commit authority.

## Context

The catalog transaction journal embedded complete before/after trees as JSON
byte arrays. Saving an installed Scratch therefore materialised `node_modules`
twice and expanded ordinary bytes into an unbounded JSON string. A real Vite
tree exceeded the engine's string limit, so Save failed before persistence.

ADR-0165 and ADR-0278 require byte-exact Save, install-claim exclusion,
copy-before-pointer ordering, and deterministic recovery. Omitting dependency
bytes, capping the journal, or treating Save separately would violate that
contract or leave reset/delete with the same fault class.

## Decision

New catalog transactions use a compact versioned journal. It contains the
before/after catalogs, a validated transaction id, phase, project ids, and
finite mutation roles. Project and stage paths are derived from those ids.
Paths, file inventories, and file bytes never enter the journal. The reader
retains version-1 inline-tree recovery for durable leftovers; new writes are
staged format only.

The owner copies trees file-by-file between VFS roots. It preserves ordinary
bytes exactly and uses the install-claim authority for privileged claim copies.
Create/reseed, reset, delete, and Save share this transaction owner. Save stages
the target from Scratch, including `node_modules`, while excluding Scratch
authority metadata and every install claim. Target definition metadata is
installed before the catalog pointer flips. Scratch remains the rollback source
until that flip.

The durable catalog is the semantic commit proof. Recovery chooses post-state
only when the committed phase or exact after-catalog bytes prove the flip;
otherwise it restores pre-state from derived rollback stages. Root application
precedes the pointer. Subscriber publication and mutation resolution follow
semantic durability.

Deleting the last disk rollback copy is post-commit garbage collection. A
failure there cannot truthfully restore pre-state without retaining another
unbounded copy. The owner therefore retries or leaves a recoverable orphan and
keeps the committed post-state; startup removes only orphan transaction stages
under the fixed derived root. Pre-commit persistence failure still rejects and
restores exact pre-state. Fault tests cover semantic transaction boundaries and
post-commit orphan collection as distinct classes.

## Consequences

- Journal size depends on catalog metadata and mutation count, not project bytes.
- Save preserves real installed trees without transferring root-bound trust.
- Crash leftovers from both journal versions recover deterministically.
- Transactions temporarily duplicate affected bytes in VFS; available storage
  remains a real quota constraint and reports loudly.
- Post-commit cleanup may complete during startup, but cannot change the
  catalog-visible result.
