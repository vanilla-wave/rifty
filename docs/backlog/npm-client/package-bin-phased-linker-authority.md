---
area: npm-client
status: draft
title: Package-bin phased linker authority
created: 2026-07-28
why: the terminal combined linker checkpoint could not prove all package files settle before one detached launcher pass across every linker entrypoint and VFS fault
user_story: As a browser-IDE user installing package CLIs, I want launchers written only after all package files settle and exact retries to repair interrupted work, but today linking interleaves package files and bins
epic: honest-shadow-substitutions
sources: [ADR-0335, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
---

## Context

This is the serial second split successor to terminal
`npm-client/package-bin-claim-linker-authority` at
`30416e72eea35cd992ef87f62b951d6c70eb45fb`. Landed PR #235 at
`main@2cdc92b3fa4b6b416006b1be8347dd4c717b5720` supplies the serial
normalization/link-ingress boundary's prepared packages and detached claims.

The existing linker remains the sole package-file and launcher writer. This
unit adds no module, public API, comparator, coordinator, scheduler, lock, or
package-specific branch.

## Reference contract

- ADR-0335 assigns materialized and ordinary package launchers to one shared
  package-bin linker after collision-free claims are admitted.
- The serial normalization/link-ingress predecessors supply exact prepared
  package paths and admitted normalized claims. This unit does not reinterpret
  raw install paths or package `bin` metadata.
- Missing targets and VFS failures stay loud; retry reconciles through the same
  writer without claiming npm collision settlement.

## Acceptance

- Public `link()`, cancellable `linkInstallTree()`, and the already-prepared
  installer path all run the same order: every package file settles, then one
  detached package-bin pass. A two-package operation ledger starts from the
  existing interleaving behavior and is RED until the last file precedes the
  first bin operation; a missing phase cannot create a false green.
- The detached pass consumes shaped claims without rereading raw install paths
  or bin metadata. Public, cancellable, prepared, and direct phased paths
  produce the same target-read and launcher-write ledger.
- Exactly one package-private writer creates every launcher. Behavioral
  ledgers and retry identity prove sole ownership; no product-source inspection
  or exact helper call graph is accepted as evidence.
- Each target must exist before its launcher write. Missing root/nested targets
  remain loud and create no launcher; repairing the file and retrying writes
  the exact shim.
- Abort parked in the first of two root/nested target reads prevents that
  launcher and all later target reads/writes. Retry completes both exact
  launchers through the same pass.
- Launcher `ENOSPC` and `EACCES` remain the returned failure, leave later work
  unapplied, and retry through the same writer to the exact final bytes.
- Existing non-colliding linking and prepared-path safety remain green.

## Parity cases

1. Public, cancellable, and already-prepared two-package paths settle the last
   package file before the first detached bin operation.
2. Direct phased use and composed entrypoints produce identical root/nested
   target-read and launcher-write ledgers through one writer.
3. Missing target and first-of-two abort stay loud, stop later work, and exact
   retry lands both launchers.
4. Root/nested `ENOSPC` and `EACCES` stop later work and retry byte-identically.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| observable-order / sibling-drift | every entrypoint settles all files before one detached bin pass | two-package public/cancellable/prepared/direct operation ledgers |
| corrupt-input | a missing target creates no launcher and repairs on retry | root/nested target table |
| torn-state | first-of-two abort stops every later bin operation; retry reconciles | root/nested later-work ledger |
| quota-perm-fail | launcher `ENOSPC` / `EACCES` stays loud, stops later work, and retries exactly | root/nested write-fault table |

## Out of scope

- Source normalization, narrow admission, and escaping-target semantics;
  `npm-client/package-bin-source-claim-authority` owns them.
- Source-list order, duplicates, and later-source errors;
  `npm-client/package-bin-claim-aggregation-authority` owns them.
- Current/prior collision and transition settlement;
  `npm-client/package-bin-claim-settlement-authority` owns them.
- Public/cancellable/prepared zero-mutation integration, optional prior ingress,
  public compat, and the non-colliding floor; landed PR #235 owns them.
- Recipe materialization, acquired-twin suppression, aliases, shims, lock,
  reports, and their order;
  `npm-client/shadow-materialized-bin-commit-authority` owns them.
- npm 11 ADD/CHANGE/no-op/remove/rebuild or direct-Link settlement;
  `npm-client/npm-11-bin-reify-authority` owns it outside this goal.

## Decisions

- `split-predecessor:
  30416e72eea35cd992ef87f62b951d6c70eb45fb`; predecessor checkpoints:
  `e39bb917bfbbe9ef4a5e6c034e54637a9a8a25ed` and
  `30416e72eea35cd992ef87f62b951d6c70eb45fb`.
- This draft was linked from the terminal predecessors while link ingress was
  pending; landed PR #235 now supplies its serial predecessor.
- JIT selection: epic Item 17 and Budget band `100–300`; Acceptance, Parity,
  and Fault matrix remain the settled split contract.
- The claim successors own normalization and zero-mutation ingress. This unit
  begins only when exact detached claims enter every linker path and owns every
  reachable mutating VFS fault in the generic linker.
- Exact helper names and call graph are not contract. Equivalent behavioral
  ledgers prove one writer and one ordering authority.
