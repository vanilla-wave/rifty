# Fault classes — one taxonomy for infra honesty

One vocabulary across the behavioral-correctness pipeline: contract (`## Fault matrix`) → implementation (fault tests) → review → unplanned defect repair (`rifty-fix`). Goal/budget/process blockers cite their violated contract/rule; never invent a fault class for them.

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

## Review convergence

Applies to parity work and changes touching cache, persistence, network, or concurrency. Outside this scope (docs/CI/process/tooling) a PR gets one ordinary review — blockers fixed in place, no checkpoints demanded.

| Gate | Required evidence |
|---|---|
| Contract | Pinned oracle; acceptance/parity cases; observable identity, lifecycle, error order; loud gaps |
| Scope | The review boundary is the unit of work, never the delivery form: Contract+RED reviews the contract + its RED tests; Final+GREEN reviews the slice diff — from the prior landed slice's tree, else the branch base. Earlier landed slices are certified, not re-reviewed; `coverage` rows count against that boundary only. Files outside §Review convergence scope (docs/CI/process/tooling/harness) carried inside an in-scope unit get ordinary review: fixed in place, never a blocker, never spending an attempt |
| Review | Checkpoint = two exhaustive find passes (fan-out + tail vs settled list) + `coverage` row per declared obligation (Fault-matrix line, Acceptance clause, public API entry, frozen artifact) — weak/missing rows block, later gap in a `pass` cell = reviewer error; each behavioral correctness blocker: fault class + RED test + sibling sweep; every blocker cites its violated declared authority (contract clause / repo rule / ADR / baseline) — a blocker no declared authority requires is reviewer error, symmetric to a miss (lands concern/backlog); goal/process blockers: violated clause/rule |
| Contract+RED evidence | Reviews the promise, never an imagined implementation — the mutant judgement (`pass` adversarial vs a plausible wrong implementation) belongs to Final+GREEN, where code exists to settle it. Four admissible blocker classes, each carrying an EXECUTED artifact: contract asserts a false fact about the oracle (probe command + output + version) · User scenario behavior no clause covers (cited scenario line) · RED does not fail now, or fails for another reason — import, typecheck (run output) · RED would pass with the scenario unimplemented (run output). Reasoning without an artifact is a concern, symmetric to the bar the contract itself carries (`decision-workflow.md` §Backlog readiness 4) |
| Repeat | Same class at one boundary, or a review change adding a state owner → redesign/split |
| External API | Proxy/wrapper semantic copy requires an ADR + differential suite |
| Testing | Same scenario runs against reference and rifty; a fake cannot close acceptance |
| Checkpoints | Contract+RED before implementation; Final+GREEN on one checked tree — verdict binds content, not commit; blocker → re-cut in place |
| Lineage | A blocker iterates on the SAME branch; re-cut = new unit boundary in place, attempt + checkpoint count carries; a split re-cut names its predecessor on that branch — closed attempts never orphan. The count is observable or it does not exist: every blocker verdict appends `contract-red: <date> — blocker @ <sha>` (or `final-green:`) to the unit doc's `## Decisions` — a pass is the existing `ready-verdict:` line; a split successor copies the predecessor's lines |
| Convergence | Blocker count not strictly falling across two consecutive rounds while findings land on the same unit → the fixes are growing the review surface faster than they close it; round N+1 will not converge — stop and report to the user. New findings each round are not progress |
| Contract escalation | 2nd consecutive Contract+RED blocker on one unit → the contract is wrong: split/re-refine it in place; an obligation review cannot pin because the contract never declared it (exactness, count, identity) → same re-refine, never another review round. A split is a re-cut, not a fresh start: the recorded verdict lines carry, and a 2nd escalation in one lineage stops to the user — the contract is not reviewable, only the user re-scopes it |
| Unit closure | Current contract proof + empty unit residuals |
| Goal closure | No linked children + empty goal residuals + end-to-end baseline proof; never source grep, warning, backlog record, or one green slice |
