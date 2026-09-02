---
area: distribution
status: draft
title: no-COI toolchain install/run operation lifecycle
created: 2026-09-02
epic: no-coi-sandbox-tier
blocked_by: [distribution/no-coi-public-toolchain-admission]
why: install and run-bin mutate one Worker realm, but Final review did not prove zero dispatch for rejected overlap, run-bin peer-end settlement, immutable post-validation inputs, ordered streams before one terminal result, or the required current mechanism sweep and forcing constraint
user_story: As an agent issuing install and installed-bin operations, I want each admitted call to settle once with ordered output while overlap fails before effects, so shared realm state cannot race or leave a promise hanging
sources: [ADR-0375, docs/process/fault-classes.md, distribution/no-coi-sandbox-build-loop]
code: [packages/runtime-js/src/host.ts, packages/runtime-js/src/protocol.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/host.test.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts]
---

## Context

Split successor of `distribution/no-coi-sandbox-build-loop` at binding Final
stop `e5347179f`; the predecessor preserves its full pre-demotion contract and
lineage. This child owns one necessary shared mechanism invariant supporting
I2 and I3. It does not own install correctness or build parity.

The forcing constraint is one Worker realm's mutable process cwd/argv/exitCode,
VFS tree and activated runtime bindings. The Worker is the sole operation
admission/terminal owner. The host validates, snapshots and correlates request
ids; it is not a second scheduler. MessagePort FIFO carries existing
stdout/stderr and the terminal result, so no sequence/ack/replay layer is
needed.

Current Class-kill inventory: Workbench/PTY active-run gates own distinct
project/session scopes; npm semaphores/in-flight maps own network acquisition;
the runtime host's `pendingRequests` owns correlation and peer fan-out; queued
package/stamp authorities deliberately conflict with this contract's no-queue
choice. The existing Worker-local binary slot is the smallest mechanism. The
active ADR-0375 carries behavior but omitted this current sweep/forcing record;
its immutable authority must be superseded at PICKUP before product work.

It owns five current HOLDS: overlap zero-dispatch; run-bin peer settlement;
post-validation mutation snapshot; exact cross-stream/terminal order; and the
active mechanism record. Upstream:
`distribution/no-coi-public-toolchain-admission`. Downstream:
`distribution/no-coi-sandbox-package-install`,
`distribution/no-coi-sandbox-build-loop`,
`distribution/no-coi-host-posture-preservation` and
`distribution/no-coi-dev-hmr-restore`.

## Challenge

challenge: 2026-09-02 — 4 problems
- Immediate overlap rejection does not follow from Worker-only admission: goal I6 explicitly admits an alive-but-blocked Worker, whose event loop cannot run the `busy` handler; Parity 1 proves only yielding operations.
- Mutable effects living in the Worker does not prove admission must live there. A host-side in-flight gate at the sole public entry rejects synchronously and remains closed through promise settlement; the chosen release-after-`postMessage` can admit a queued call before host settlement, contradicting Acceptance 6.
- Acceptance 4 names no signal for unexpected clean Worker close: browser Worker/MessagePort exposes no peer-close event, while new close protocol and heartbeat are excluded, so `pendingRequests` cannot reject rather than hang.
- Necessity is unsized against the goal: I2/I3 require sequential install/build parity, while overlap, adversarial mutation, peer-end matrices, and exact merged-output ordering are called necessary substrate without evidence they block or materially affect that loop; review HOLD count is not user-impact evidence.

Disposition:

- P1 answered: immediate BusyError covers a live Worker that can process frames,
  including the held-network overlap oracle. An alive-but-blocked event loop
  cannot service any request; goal I6 deliberately leaves detection to the
  agent timeout and explicit restart. This child makes no wedge-settlement
  claim.
- P2 answered: the Worker is the sole mutating-realm boundary and its existing
  slot protects every delivered protocol operation regardless of host-client
  version. Replacing it with a host gate would leave the Worker invariant to a
  trusted client; keeping both would add a second admission owner. Neither is
  cheaper than retaining the existing slot. “Settled” below means the Worker
  posts its one terminal result after drain/flush; MessagePort order prevents a
  later delivered operation from overtaking it.
- P3 answered: `clean-close` means the Worker's intercepted explicit
  `self.close()` terminal frame, not an unobservable silent port disappearance.
  Dispose is host-known and crash is the Worker error event. Silent peer loss
  without either signal would require excluded heartbeat/deadline machinery.
- P4 overridden by the user, 2026-09-02: preserve all 14 current HOLDS and keep
  install/run lifecycle plus busy coordination as one necessary shared I2/I3
  substrate. The child therefore proves the existing seam; it adds no broader
  lifecycle capability.

## User scenario

After one public toolchain sandbox is ready, an agent starts either an exact
manifest install or an arbitrary installed bin. While its Worker remains able
to service frames and the operation yields at a held boundary, every second
install/run combination rejects immediately without entering the operation.
The first call emits its real stdout/stderr in order and settles once. Dispose,
Worker crash or an explicit intercepted `self.close()` rejects either
operation instead of hanging or claiming rollback.

## Reference contract

- ADR-0375 Decisions 1 and 3 retain immediate busy rejection and existing
  Worker terminal settlement; active authority lacks the required Class-kill
  evidence and must be superseded, not edited.
- `docs/process/fault-classes.md` Class-kill and Seam contract require one owner
  and one fault proof across admission/close. The MessagePort model gives
  ordered exactly-once delivery only while both peers live; peer death loses
  all in-flight work.
- Current seam: host `pendingRequests` correlation and exact input validators;
  Worker `busy` admission around `dispatch`; installed-bin run awaits entry,
  drain and VFS flush before posting its result.
- Final review at `c2b13d0f3` found each named proof gap; existing install-only
  peer matrices and flattened output collectors do not close them.

## Acceptance

1. Before implementation, a superseding decision record inventories the
   current repo-wide class, states the shared-realm forcing constraint and
   keeps one Worker-local binary admission slot. Host correlation remains
   correlation only. No new lock, FIFO, queue, map, scheduler or state owner is
   introduced.
2. Across install→install, install→run, run→install and run→run, a first
   operation held at a yielding real boundary is admitted and the second rejects
   `SandboxToolchainBusyError`. An operation-boundary sentinel proves the
   rejected request never calls install/run dispatch, performs no VFS/process/
   binding/network effect and emits no output; the original later settles.
3. Install and run inputs are exact-validated and copied once before the first
   await/post/effect. Mutating the caller object or args after invocation cannot
   alter the posted request. Missing/extra/symbol/accessor/sparse fields reject
   with zero post and zero mutation.
4. The full matrix `install|runBin × dispose|crash|explicit self.close`
   settles the admitted promise exactly once with the existing typed peer
   failure. No signalled case hangs or reports success; because death cannot
   prove non-application, no rollback/retry claim is made.
5. A package-generic installed bin emits interleaved stdout/stderr markers and
   exits. Public runtime events preserve their exact cross-stream order; one
   correlated terminal result follows all output and only then resolves
   `runBin`. Drain/flush precede that result. No duplicate terminal frame or
   post-terminal output is admitted.
6. Slot release happens after the terminal result post on success/failure. A
   later Worker-delivered operation cannot overtake that terminal frame;
   rejection never queues or retries itself.

## Parity cases

1. Four-way overlap matrix with a held real boundary plus dispatch/effect
   sentinels distinguishes immediate rejection from hidden execution or FIFO.
2. Caller mutation matrix covers install cwd/registry and run cwd/binPath/args
   while readiness/post is held; the wire snapshot remains the first validated
   values.
3. Peer-end matrix covers both operations and three observable terminal modes
   (dispose, error event, explicit `self.close()` frame), exact one rejection
   and no settlement timeout.
4. Ordered-output bin emits `stdout A → stderr B → stdout C`, then exits;
   Worker-port frames and public runtime events retain that order before one
   toolchain result.
5. Mechanism sweep compares the Worker slot with PTY/project gates, npm
   acquisition dedupe and queued package/stamp authorities, recording why none
   can own or replace this boundary.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `concurrent-same-key` × install/run admission | one Worker-owned slot; rejected overlap has zero operation dispatch/effects and no queue | Acceptance/Parity 1-2/1,5; four-way held-boundary matrix |
| `corrupt-input` + `observable-order` × request validation | exact snapshot before await/post/effect; caller mutation cannot alter it | Acceptance/Parity 3/2; readiness-held mutation matrix |
| Worker peer death × admitted install/run | every promise rejects once; no hang, retry, rollback or not-applied claim | Acceptance/Parity 4/3; six-case seam fault matrix |
| `observable-order` + `lossy-aggregate` × run output/terminal | exact cross-stream order, then one result after drain/flush | Acceptance/Parity 5-6/4; raw frame timeline |

## Out of scope

- No package-version/install-tree proof, npm fault reimplementation,
  installed-bin semantic result or build artifact parity.
- No Vite/Rolldown identity, version, bin path, callback, type or lifecycle;
  lifecycle fixtures are package-generic.
- No cancellation, stdin, shell grammar, resident dev server or preview URL.
- No heartbeat, epoch, journal, automatic reconnect/retry, exactly-once
  recovery, hidden retry, queue or crash durability. Peer death is a loud
  terminal loss at tier `works`.
- No promise that an alive-but-blocked Worker can process BusyError or terminal
  frames; agent timeout and the dev-HMR restart child own that works-tier case.
- No new public method, protocol field, correlation map or process/VFS owner.

## Decisions

review: checkpoints — concurrency and MessagePort lifecycle seam.

predecessor: `distribution/no-coi-sandbox-build-loop`

- Owns Final HOLDS: overlap non-dispatch, run-bin peer settlement, immutable
  validated inputs, exact stream/terminal order and ADR-0375 mechanism sweep.
- Dependency direction: public admission first; both I2 install and I3 build
  depend on this substrate; host posture and dev-HMR remain downstream.
- User override, 2026-09-02: the five lifecycle HOLDS remain required as one
  shared I2/I3 substrate despite the critic's impact-sizing objection.
- `contract-red: 2026-09-01 — blocker @ 326f5b70e`
- `ready-verdict: 2026-09-01 — Contract+RED @ f0066d4d2`
- `final-green: 2026-09-01 — blocker @ 07d370651`
- `final-green: 2026-09-01 — blocker @ bcff49986`
- `final-green: 2026-09-01 — blocker @ 541c4cd6c`
- `contract-red: 2026-09-01 — blocker @ 2f1063608`
- `ready-verdict: 2026-09-01 — Contract+RED @ ead27000f`
- `final-green: 2026-09-01 — blocker @ a909a38a9`
- `final-green: 2026-09-01 — blocker @ 6f86d2e7f`
- Bounded-cause split successor certified Final+GREEN at `40ded4758`.
- `ready-verdict: 2026-09-01 — Contract+RED @ df3cc811d`
- `final-green: 2026-09-02 — blocker @ 01465c6ae`
- Descriptor split successor certified Final+GREEN at `dce86792d`.
- `contract-red: 2026-09-02 — blocker @ 41d63c086`
- `ready-verdict: 2026-09-02 — Contract+RED @ 15dbca164`
- `final-green: 2026-09-02 — blocker @ c2b13d0f3`
- Count lineage: `07d370651`/`bcff49986`/`541c4cd6c` counts are unavailable;
  counted Final rounds are `1@a909a38a9 → 1@6f86d2e7f` (stop, bounded child
  PASS), `1@01465c6ae` (carried stop, descriptor child PASS), then
  `15@c2b13d0f3`; latest `1→15` fired convergence. Contract continuation was
  `1@41d63c086 → PASS@15dbca164`.
- Binding stop is recorded at `e5347179f`. Its PR-body band HOLD was already
  fixed in draft PR 294 and is excluded from this child's five current HOLDS.
