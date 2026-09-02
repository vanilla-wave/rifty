# Fault classes — one taxonomy for infra honesty

One vocabulary across the behavioral-correctness pipeline: contract (`## Fault matrix`) → implementation (fault tests) → review (`review.md`) → unplanned defect repair (`rifty-fix`). Goal/budget/process blockers cite their violated rule id; never invent a fault class for them.

## Axes

Apply at any boundary — network, storage/OPFS, cache, worker/process, concurrency:

| Axis | Fault | Signal / kill |
|---|---|---|
| `unbounded-read` | stream/body/loop lacks progress bound or byte cap | hung body → bounded reader |
| `torn-state` | failure between write steps; partial state later trusted | multi-step state → one commit authority |
| `corrupt-input` | malformed, truncated, duplicate, or extra input | validate once at trust boundary |
| `poisoned-cache` | changed/body-dependent bytes under a stable key | key exact content/identity |
| `provenance-lie` | success or source claimed without proof | verify before claiming |
| `false-fallback` | optional-path failure breaks instead of degrading | explicit fallback outcome |
| `concurrent-same-key` | racing writers become reader-visible | one serialized writer |
| `quota-perm-fail` | quota/permission failure swallowed mid-operation | visible degrade or loud throw |
| `observable-order` | early validation hides required side effects/error priority | preserve protocol/syscall order |
| `sibling-drift` | duplicated semantic drifts across twins/backends | shared suite or shaping chokepoint |
| `frozen-assumption` | self-referential test pins unverified behavior | external oracle/golden |
| `lossy-aggregate` | gate compares a projection on which inputs collide | exact bytes/text/digest |

## Boundary failure models

Select axes per boundary: cite its row, strike physically excluded faults, and
fix a missing/wrong model before adding machinery.

| Boundary | While alive | Real fault surface | Physically excluded |
|---|---|---|---|
| MessagePort / dedicated Worker (page↔owner, owner↔child) | messages exactly-once, ordered, no partial loss; a Worker `error` default rethrows into its creator global unless the owning handler cancels it | slow peer — a local deadline may flip UI state but never proves not-applied; only the peer's terminal or its death settles an admitted mutation · peer death / port close = total inflight loss · uncanceled Worker fatal is re-reported at each creator ancestor · respawn epoch: new peer ignorant of old inflight | lost-then-replayed, duplicate message delivery, message reorder |
| BroadcastChannel | ordered per sender→receiver pair while both attached | receiver not-yet / no-longer attached silently misses frames; no delivery receipt | duplicate delivery, reorder within a pair |
| SAB sync-RPC ring (child caller ↔ parent dispatcher) | shared memory: no loss/dup/reorder while both realms live; atomic publish/dispatch/consume claims enforce one live exchange | second caller/consumer fails at its claim · caller or responder death in `WRITING`/`READY`/`HANDLING` leaves a loud permanent wedge and the blocked caller until owner teardown · oversize reply degrades to an in-band error reply | transport loss, duplicate delivery, reorder |
| Service worker | none — killable between any two events | inflight fetch/registration lost without notice; handler re-runs from scratch; SW-side route state outlives the page | — (full surface) |
| Network (registry, CDN, eddy) | none | the full distributed set: loss, duplicate, reorder, replay, stall, partial/corrupt body | — |
| Storage (OPFS/IndexedDB) | per-op atomicity only where the API grants it | torn multi-step writes, quota/permission mid-op, cross-tab concurrent writers | — |

## Honest outcome and fault tests

Every axis × operation ends in transparent fallback, visible correct
degradation, or loud throw—never wrong bytes/provenance, a hang, or trusted torn
state. Inject one fault at one boundary in `*.fault.test.ts` or an owning
fault-labelled suite; use small boundary decorators, not one framework.

## Class-kill

- Second reachable instance of one axis at one boundary → one chokepoint, validation boundary, or gate.
- Before adding correlation/FIFO/epoch/ledger/lock, inventory the class repo-wide. A third copy requires consolidation or an ADR proving separate authority.
- A third mechanism guarding one file/key means no owner: stop and move the invariant to one serialized authority.
- Porting a mechanism (quarry branch, extraction, revived past work) = adding it: the port re-states its forcing constraint; constraint gone → deletion, not port. Plan or quarry provenance never justifies machinery.

## Seam contract

Two authorities exchanging lifecycle (reserve/commit/teardown, admission/close)
→ the seam carries one settlement contract: which peer errors are expected
cancellation outcomes, ONE owner, one fault test crossing both sides.
Locally-proven ends never prove the seam.

## Review

Scope, authority, severity, evidence bar: `review.md`. Stops: `stops.md`.
