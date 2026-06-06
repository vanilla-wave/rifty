# ADR 0085: setImmediate queue rep + check-phase drain-order contract

Status: Accepted
Date: 2026-06

## Context

`packages/runtime-js/src/builtins/timers.ts` polyfills `setImmediate` /
`clearImmediate`. The old rep was an array + ONE `MessageChannel` message per
scheduled immediate; `port1.onmessage` ran exactly one `.shift()` per message
("1 immediate per macrotask"). `clearImmediate` was O(n) `findIndex`+`splice`;
the queue scan/splice cost is what perf-audit 2026-06-05 #28 targets.

`./builtins/timers` is a PUBLIC cross-package subpath export (package.json,
ratified by ADR-0018 / Q-2026-05-23-005), consumed by
`apps/playground/.../real-vite-bootstrap.ts` (installTimerGlobals) and registered
as `node:timers` in `@riftydev/io`'s builtin registry. So the drain ORDER is a
cross-package contract — this is a rule-1 ADR (touches public API between
packages), not a CHANGELOG-only refactor.

Two emergent guarantees of the old impl are LOAD-BEARING (Node parity):
1. A `setImmediate` scheduled from INSIDE a running immediate callback fires in
   the NEXT check phase, not the current one (Node check-phase semantics).
2. `setImmediate` beats `setTimeout(0)` (the MessageChannel task dispatches ahead
   of a timer task).

Both held for free under "1 immediate per macrotask". Under the new Map rep
guarantee (1)'s observable STRING also holds for free — a nested immediate gets
the highest id and the ascending-id drain visits it last — so the tail-snapshot
does NOT change the single nested-string order. Its load-bearing role is PHASE
SEPARATION: a nested immediate must run in a LATER check phase so it interleaves
correctly with timers / microtasks scheduled between phases (not exposed by the
nested-string case alone). Guarantee (2) breaks only if the scheduler switches
to `setTimeout(0)`.

## Decision

Rep: `const immediates = new Map<number, {fn,args}>()` keyed by the monotonic
positive-integer id. A Map iterates integer keys in numeric-ascending =
insertion order → FIFO drain for free; `clearImmediate` is O(1) `delete`.

Drain (`port1.onmessage`): take a TAIL SNAPSHOT `const tail = nextImmediateId` on
entry and run only ids `< tail`, `delete`-ing each as it runs (per-callback
try/catch+console.error preserved). An immediate scheduled DURING the drain gets
id `>= tail` and is left for its own message = NEXT check phase. The ascending
Map iteration lets the loop `break` at the first `id >= tail`.

Scheduling: KEEP one `MessageChannel` message per scheduled immediate (NOT
coalesced, NOT `setTimeout(0)`). One-message-per-call means every immediate —
including a nested one — has its own pending message, so nothing is ever
stranded regardless of the snapshot; the snapshot only governs WHICH phase each
runs in. Keeping MessageChannel (not setTimeout) preserves guarantee (2).
`ImmediateHandle = {readonly id}` is unchanged (used by setImmediatePromise /
clearImmediate). The no-MessageChannel fallback keeps `setTimeout(0)` and stays
realm-specific (jsdom / node test envs without a real check phase).

Options for scheduling:
- **One message per immediate (CHOSEN).** No stranding risk; snapshot handles
  phase ordering. Lowest risk.
- Coalesce to a single guarded message + re-arm-if-nonempty (REJECTED). Needs a
  re-arm check so a nested immediate isn't stranded with no pending message —
  extra moving part for no measured win on this path.

## Consequences

- `clearImmediate` is O(1) (`Map.delete`) vs O(n) findIndex+splice.
- Guarantees (1) and (2) preserved — the rewrite is Node-parity-equivalent to
  the old impl, proven head-to-head (rifty vs Node) by the two parity cases.
- Public `./builtins/timers` exported symbols + handle shape unchanged.
- Negative: the tail-snapshot is a non-obvious invariant governing PHASE
  SEPARATION (not the single nested-string order, which the ascending-id rep
  already produces under a greedy drain too). The mutation-catching guards are
  the MessageChannel scheduler (`immediate-vs-timeout`, RED on `setTimeout(0)`)
  and `clearImmediate` FIFO — `immediate-nested` pins the Node-parity CONTRACT,
  not the snapshot mechanism.
- Drain-order is now an explicit documented contract (this ADR), not emergent.

## Acceptance criteria

- [x] Parity `cases/timers/immediate-nested.case.ts` — nested setImmediate defers
  to the next check phase (`A,A-end,C,B-nested`), driven via `require('node:timers')`.
- [x] Parity `cases/timers/immediate-vs-timeout.case.ts` — setImmediate beats
  setTimeout(0) (gated on MessageChannel presence). RED if the scheduler drops to
  setTimeout(0).
- [x] Conformance `event-loop.test.ts` — nested-defers under installTimerGlobals;
  clearImmediate mid-drain removes a still-queued item; large burst FIFO with a
  mid-burst clear.
- [x] Exported symbols + `{id}` handle shape of `./builtins/timers` unchanged.
