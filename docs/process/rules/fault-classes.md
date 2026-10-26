# Fault classes — one taxonomy for infra honesty

One vocabulary across the behavioral-correctness pipeline: contract (`## Fault matrix`) → implementation (fault tests) → review (`docs/process/README.md` §Review rules) → unplanned defect repair (`rifty-fix`). Goal/budget/process blockers cite their violated rule id; never invent a fault class for them.

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
| MessagePort / dedicated Worker (page↔owner, owner↔child) | transport delivery exactly-once, ordered, no partial loss; a Worker `error` default rethrows into its creator global unless the owning handler cancels it | Worker global message can dispatch before an async bootstrap installs its listener (`observable-order`); publish listener readiness before transferring init · slow peer — a local deadline may flip UI state but never proves not-applied; only the peer's terminal or its death settles an admitted mutation · peer death / port close = total inflight loss · uncanceled Worker fatal is re-reported at each creator ancestor · a nested child's termination notice queued when its creator realm starts shutdown is dropped, retaining that realm and its ancestors (ADR-0548) · respawn epoch: new peer ignorant of old inflight | lost-then-replayed, duplicate message delivery, message reorder |
| BroadcastChannel | ordered per sender→receiver pair while both attached | receiver not-yet / no-longer attached silently misses frames; no delivery receipt | duplicate delivery, reorder within a pair |
| SAB sync-RPC ring (child caller ↔ parent dispatcher) | shared memory: no loss/dup/reorder while both realms live; atomic publish/dispatch/consume claims enforce one live exchange | second caller/consumer fails at its claim · caller or responder death in `WRITING`/`READY`/`HANDLING` leaves a loud permanent wedge and the blocked caller until owner teardown · oversize reply degrades to an in-band error reply | transport loss, duplicate delivery, reorder |
| Service worker | none — killable between any two events | inflight fetch/registration lost without notice; handler re-runs from scratch; SW-side route state outlives the page | — (full surface) |
| Owned in-process policy/graph projection | ordinary calls carry the selected values without transport | lost policy/source provenance, malformed path/version, ambiguous projection, sibling classification drift, wrong error order | transport loss, duplicate delivery, reorder |
| Owned native child/browser lifecycle | local calls ordered; child/process can die between calls | signal drops started-attempt evidence (`torn-state`/`provenance-lie`); rejected browser close skips sibling child teardown (`sibling-drift`) | transport duplicate delivery, reorder |
| Browser diagnostic observer → native target | CDP requests are ordered; target can stop before inspection | observer reads a stopped target and aborts the browser (`false-fallback`, Chromium crbug 573662744); omit unsupported telemetry, retain the native operation and its verdict | transport duplicate delivery, reorder |
| Owned async continuation → builtin context | synchronous prefix executes in scope; suspension resumes a later job | lost continuation-local scope, nested/racing contexts, early restore before resumed read | transport duplicate/reorder within one direct call |
| Rendered UI → owned semantic judge | visible text/layout may vary under the same public promise | frozen-assumption rejects allowed representation; corrupt-input admits hidden, extra, wrong-direction or imprecise values; lossy-aggregate hides duplicate rows | transport replay/reorder during one settled DOM read |
| Retained verdict → reviewed Git contract | a commit identifies immutable source bytes | current document deleted/changed/weakened; reviewed object unavailable; incomplete coverage under a substituted authority | transport replay/reorder within a local read |
| Native child stdout/stderr pipe | each pipe carries ordered bytes with backpressure; chunks can split UTF-8 | collector capacity, producer stall/death, spawn/nonzero exit; partial output cannot prove completion | transport duplicate/reorder within one pipe |
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

## Guest-package adaptations

An adaptation is any transform of installed package bytes or generated twin
source, or an admission narrower than the range the package itself accepts
(exact pin, version gate, manifest override) (owner ADR-0384; inventory
`docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md`).
Each one records its class, authority, drift-loud anchor and kill condition:

| Class | Meaning | Authority |
|---|---|---|
| `substitution-environment` | a declared twin's environment (FS, startup, named gates) | the substitution ADR + compat page |
| `handle-mapping` | a Node handle/request mapped onto the realm keepalive | ADR-0152 §1 class + the Node analogue |
| `upstream-edge` | an upstream defect reproduced on real Node at the same version and location | the real-Node artifact (command + output + version) |
| `backport` | an upstream fix at a named version | the upstream commit/version |

`platform-gap` — a patch or narrowed admission that makes a package work around a rifty divergence —
is admissible only as declared interim debt: its row links the platform
item/ADR that owns the divergence and states the kill condition; it
dies when that lands. An undeclared one is debt by construction (`AGENTS.md`
§Fidelity). A class claim without its artifact is a `frozen-assumption`; a
second instance of one class at one boundary follows §Class-kill.

Every adaptation is a ceiling (`AGENTS.md` §Fidelity): the compat claim it
carries reads ⚠️ and names the admitted version or range until its kill condition lands;
kill condition `none` = a permanent ceiling.

## Seam contract

Two authorities exchanging lifecycle (reserve/commit/teardown, admission/close)
→ the seam carries one settlement contract: which peer errors are expected
cancellation outcomes, ONE owner, one fault test crossing both sides.
Locally-proven ends never prove the seam.

## Review

Scope, authority, severity, evidence bar, stops: `docs/process/README.md` (`REV`, `STOP`).
