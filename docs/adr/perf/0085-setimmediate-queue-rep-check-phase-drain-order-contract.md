# ADR 0085: setImmediate queue rep + check-phase drain-order contract

Status: Accepted
Date: 2026-06

> TL;DR: `setImmediate` rep → id-keyed Map (O(1) clearImmediate); drain exactly one lowest-id per MessageChannel macrotask to preserve Node check-phase parity (nested defers, microtask checkpoint between immediates, beats setTimeout(0))

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

Three emergent guarantees of the old impl are LOAD-BEARING (Node parity):
1. A `setImmediate` scheduled from INSIDE a running immediate callback fires in
   the NEXT check phase, not the current one (Node check-phase semantics).
2. `setImmediate` beats `setTimeout(0)` (the MessageChannel task dispatches ahead
   of a timer task).
3. The microtask queue drains BETWEEN consecutive immediates — one immediate per
   check-phase macrotask, so a callback's post-`await` continuation runs before
   the NEXT immediate, and that next immediate sees its side effects.

All three held for free under "1 immediate per macrotask". Guarantee (1) needs
PHASE SEPARATION via one-message-per-call, NOT a snapshot: a nested immediate
posts its own (higher-id) message serviced by a LATER check phase. Guarantee (3)
needs the per-macrotask drain — a greedy batch that runs every queued immediate
in one macrotask SKIPS the inter-immediate microtask checkpoint (BLOCKER #2,
empirically confirmed vs Node v24.5.0). Guarantee (2) breaks only if the
scheduler switches to `setTimeout(0)`.

## Decision

Rep: `const immediates = new Map<number, {fn,args}>()` keyed by the monotonic
positive-integer id. A Map iterates integer keys in numeric-ascending =
insertion order → FIFO drain for free; `clearImmediate` is O(1) `delete`.

Drain (`port1.onmessage`): drain EXACTLY ONE item — the lowest id (Map iterates
ascending = FIFO) — `delete`-ing it before running (per-callback
try/catch+console.error preserved). One `MessageChannel` message per call ⇒ one
immediate per macrotask ⇒ the microtask queue drains BETWEEN consecutive
immediates (guarantee 3, Node check-phase parity). A nested immediate posts its
own (higher-id) message serviced in the NEXT check phase (guarantee 1) — no
snapshot needed, no stranding (one message per call). NB: NOT a greedy batch
(run-every-queued-id in one macrotask) — that skips the inter-immediate
microtask checkpoint (BLOCKER #2).

Scheduling: KEEP one `MessageChannel` message per scheduled immediate (NOT
coalesced, NOT `setTimeout(0)`). One-message-per-call means every immediate —
including a nested one — has its own pending message, so nothing is ever
stranded. Keeping MessageChannel (not setTimeout) preserves guarantee (2).
`ImmediateHandle = {readonly id}` is unchanged (used by setImmediatePromise /
clearImmediate). The no-MessageChannel fallback keeps `setTimeout(0)` and stays
realm-specific (jsdom / node test envs without a real check phase) — already
one-timer-per-immediate, so it has the per-macrotask drain too.

Options for the drain:
- **Drain-exactly-one per message (CHOSEN).** One immediate per macrotask, so the
  microtask checkpoint runs between consecutive immediates (guarantee 3) and a
  nested immediate's own message lands it in the next phase (guarantee 1). No
  stranding, lowest risk.
- Tail-snapshot batch — run all ids `< nextImmediateId` in one drain (REJECTED).
  Preserves guarantee (1)'s single nested-string order but BREAKS guarantee (3):
  batching consecutive immediates into one macrotask skips the inter-immediate
  microtask checkpoint (BLOCKER #2). The snapshot was also vestigial — one
  message per call already separates phases.

## Consequences

- `clearImmediate` is O(1) (`Map.delete`) vs O(n) findIndex+splice — the only
  real win of the Map rep over the old array (drain scheduling is identical).
- Guarantees (1), (2), (3) preserved. CORRECTION: the original tail-snapshot
  rewrite was claimed "Node-parity-equivalent" but MISSED guarantee (3) — its
  greedy batch ran consecutive immediates in one macrotask, skipping the
  inter-immediate microtask checkpoint (BLOCKER #2). The per-macrotask drain-one
  is what delivers the intra-phase microtask checkpoint; drain-one is byte-
  equivalent in scheduling to the old array+single-`shift`, which had all three
  guarantees for free.
- Public `./builtins/timers` exported symbols + handle shape unchanged.
- Drain-order is now an explicit documented contract (this ADR), not emergent.

## Acceptance criteria

- [x] Parity `cases/timers/immediate-nested.case.ts` — nested setImmediate defers
  to the next check phase (`A,A-end,C,B-nested`), driven via `require('node:timers')`.
- [x] Parity `cases/timers/immediate-microtask-checkpoint.case.ts` — microtask
  checkpoint BETWEEN consecutive immediates (`A-start | A-after-await |
  B-reads:set-by-A | C`), guarantee (3) / BLOCKER #2. RED on a greedy batch.
- [x] Conformance `event-loop.test.ts` ("setImmediate fires after the current
  task" + the nested / clearImmediate / FIFO-burst drain tests) pins rifty's
  MessageChannel scheduler. NOTE: a cross-runtime `setImmediate`-beats-
  `setTimeout(0)` PARITY oracle is INVALID — Node's top-level
  setImmediate-vs-setTimeout(0) order is non-deterministic (empirically ~1/10
  inverts), so it cannot be a stable parity case (the original such case was
  removed for this reason).
- [x] Conformance `event-loop.test.ts` — nested-defers under installTimerGlobals;
  clearImmediate mid-drain removes a still-queued item; large burst FIFO with a
  mid-burst clear.
- [x] Exported symbols + `{id}` handle shape of `./builtins/timers` unchanged.
