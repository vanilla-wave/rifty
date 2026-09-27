---
area: runtime-js
status: draft
title: Retained VM mirrors do not reflect later guest mutations
created: 2026-09-23
why: arrays and exotic backings are snapshots even while their guest handles retain identity
sources: [docs/backlog/runtime-js/reference/advanced-ipc-proxy-provenance-evidence.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/membrane.ts]
---

## Context

Node24.16.0 versus explicit QuickJS: export Map/Set/Date/Array; mutate the same
guest value in a later run; inspect the retained host reference. Native reflects
the mutation; rifty keeps its earlier backing. Exact probe/evidence in source.
Array/Date snapshot policy predates this epic; new Map/Set mirrors share it.

Owner: runtime-js/vm/membrane. Trigger: a scenario retaining returned values
across guest mutations. Independent authority assessment separates this VM
shared-state boundary from IPC's snapshot of the actual host input at send.
Actual host writes before send are retained; changes after send are isolated.
Blindly refreshing from the guest would erase legitimate host writes.

Compat ❌ explicit. No carrier prescribed; preserve both directions, identity,
cycles and mutation ordering when compiling the contract. Fault boundary:
in-process graph projection, poisoned-cache/provenance-lie, no transport faults.
Dedup: VM/QuickJS backlog titles/code, epic maps, traps and declined ADR index
contain no retained-mirror mutation owner.
