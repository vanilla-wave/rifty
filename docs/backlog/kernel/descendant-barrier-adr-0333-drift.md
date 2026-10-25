---
area: kernel
status: draft
title: Reconcile ADR-0333 with the shipped descendant settlement barrier
created: 2026-10-25
why: ADR-0333 says no timer can prove settlement and no timer ships, yet the code cuts after a 1000 ms deadline; a walked non-root Worker may also skip the barrier
sources: [docs/adr/kernel/0333-descendant-settlement-barrier-preserves-recursive-teardown-ordering.md]
code: [packages/kernel/src/process-manager.ts]
---

## Question

Which order is authoritative for ancestor teardown, and does an ADR overturn
need recording?

## Context

- `DESCENDANT_SETTLEMENT_DEADLINE_MS = 1_000` (`process-manager.ts`,
  `waitForPhysicalRemoteDescendants`) shipped in commit 75e407b00 (`fix: bound
  the descendant settlement barrier`); on expiry the physical cut proceeds
  with a stderr diagnostic, pinned by `process-manager-tree.fault.test.ts`
  ("cuts an unresponsive physical owner once the descendant proof misses its
  deadline"). ADR-0333 still reads "no timeout can prove settlement" and "no
  … timer ships"; no dated correction or superseding ADR records the change
  (`DEC-2` asks for a critic on an overturn).
- Reading only, not executed: `terminateDescendants` calls
  `child.terminate(signal)` on a walked non-root Worker child without that
  child's `terminatePhysicalForwardedRoutes` or descendant barrier, which
  `killRecordTree` applies to the root only.

Found during the ADR-0548 review (PR #392). Owner: kernel process lifecycle.
Trigger: next change to the barrier or the tree walk. Next probe: a fault test
killing a supervisor whose walked Worker child owns a forwarded route.
