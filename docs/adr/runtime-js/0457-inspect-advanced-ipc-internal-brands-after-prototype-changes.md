# ADR 0457: Inspect advanced IPC internal brands after prototype changes

Status: Accepted
Date: 2026-09

> TL;DR: Advanced IPC validates built-in internal slots even when a sender changes prototypes; views with invalid prototype families stay named loud.

## Context

ADR-0448/0454 preflight used `instanceof` for raw SAB, Map and Set. A sender can
replace those objects' prototypes without changing their internal data. Node
v24.16.0 physical fork still rejects raw/Set SAB and preserves Map Buffer;
rifty silently admitted shared backing or lost Buffer brand. A changed-prototype
view also bypassed the intended host-object ceiling. Oracle, baseline and RED:
`docs/backlog/runtime-js/reference/advanced-ipc-prototype-fidelity-evidence.md`.

## Decision

Read raw SAB, Map and Set internal slots through captured intrinsic getters;
traverse Map/Set with the already captured intrinsic `forEach`. Read every
view's backing through typed-array/DataView intrinsic getters, then reject an
ArrayBuffer-backed view whose prototype no longer belongs to its native view
family. SAB-backed views keep ADR-0454's named ceiling. No new IPC lane or
transport state.

Candidates: `instanceof` misses changed prototypes (executed RED);
`Object.prototype.toString` also becomes `[object Object]` after the change;
internal-slot getters preserve the actual data brand and run no guest methods.

## Consequences

- Raw SAB and Map/Set hidden entries cannot bypass preflight by changing
  prototypes; views that Node rejects remain loud.
- The existing raw-SAB error text names its internal brand, while Node's
  changed-prototype error text names `Object`. Both reject synchronously.
