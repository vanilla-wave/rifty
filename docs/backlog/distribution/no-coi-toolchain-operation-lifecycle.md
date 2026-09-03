---
area: distribution
status: ready
title: no-COI toolchain install/run operation lifecycle
created: 2026-09-02
epic: no-coi-sandbox-tier
why: install and run-bin share one Worker realm, but Final review did not prove zero dispatch for rejected overlap, run-bin peer-end settlement, immutable post-validation inputs, ordered streams before one terminal result, or the required mechanism sweep
user_story: As an agent issuing install and installed-bin operations, I want each admitted call to settle once with ordered output while another install/run fails before effects, so those operations cannot race or leave a promise hanging
sources: [ADR-0376, docs/process/fault-classes.md, docs/backlog/distribution/reference/no-coi-toolchain-operation-lifecycle-evidence.md, distribution/no-coi-sandbox-build-loop]
code: [packages/runtime-js/src/host.ts, packages/runtime-js/src/protocol.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/host.test.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts]
---

## Context

Split successor of `distribution/no-coi-sandbox-build-loop` at binding Final
stop `e5347179f`; the predecessor preserves its full pre-demotion contract and
lineage. This child owns one necessary shared mechanism invariant supporting
I2 and I3. It does not own install correctness or build parity.

The forcing constraint is one Worker realm's mutable process cwd/argv/exitCode,
VFS tree and activated runtime bindings. Its binary slot is the sole outer
admission owner for install/run frames. The host validates, snapshots and
correlates requests and owns public-promise settlement on result or signalled
peer end; it never schedules operations. MessagePort FIFO carries existing
stdout/stderr and the result, so no sequence/ack/replay layer is needed.

ADR-0376 records the Class-kill inventory and rejects host admission,
project/package FIFOs and per-operation Workers. Workbench/PTY gates own other
project/session scopes; npm semaphores/in-flight maps own acquisition;
`pendingRequests` owns correlation/peer settlement. The existing Worker slot
is the smallest mechanism.

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
- P2 answered: the Worker slot protects install/run frames regardless of host
  client. Replacing it with a host gate leaves raw delivered frames to a
  trusted client; keeping both adds a second admission owner. “Published”
  below means the Worker posts its result after drain/flush; the host separately
  settles the correlated public promise.
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

- ADR-0376 retains the generic ADR-0375 authority and now fixes install/run
  admission, host settlement, forcing constraint and Class-kill sweep.
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

1. ADR-0376 inventories the repo-wide class, states the install/run
   shared-realm forcing constraint and keeps one Worker-local binary admission
   slot. Host validation/correlation/peer settlement remain separate. No new
   lock, FIFO, queue, map, scheduler or state owner is introduced. → REV-7
2. Across install→install, install→run, run→install and run→run, a first
   operation held at a yielding real boundary is admitted and the second rejects
   `SandboxToolchainBusyError`. An operation-boundary sentinel proves the
   rejected request never calls install/run dispatch, performs no VFS/process/
   binding/network effect and emits no output; the original later settles.
   → I2, I3
3. Install and run inputs are exact-validated and copied once before the first
   await/post/effect. Mutating the caller object or args after invocation cannot
   alter the posted request. Missing/extra/symbol/accessor/sparse fields reject
   with zero post and zero mutation. → I2, I3
4. The full matrix `install|runBin × dispose|crash|explicit self.close`
   settles the admitted promise exactly once with the existing typed peer
   failure. No signalled case hangs or reports success; because death cannot
   prove non-application, no rollback/retry claim is made. → scenario
5. A package-generic installed bin emits interleaved stdout/stderr markers and
   exits. Public runtime events preserve their exact cross-stream order; one
   correlated terminal result follows all output and only then resolves
   `runBin`. Drain/flush precede that result. No post-terminal output is
   observed; rejection never queues or retries itself.
   → scenario

## Parity cases

1. Four-way overlap matrix with a held real boundary plus dispatch/effect
   sentinels distinguishes immediate rejection from hidden execution or FIFO.
   Artifact: lifecycle evidence §Overlap. → I2, I3
2. Caller mutation matrix covers install cwd/registry and run cwd/binPath/args
   while readiness/post is held; the wire snapshot remains the first validated
   values. Artifact: lifecycle evidence §Snapshot. → I2, I3
3. Peer-end matrix covers both operations and three observable terminal modes
   (dispose, error event, explicit `self.close()` frame), exact one rejection
   and no settlement timeout. Artifact: lifecycle evidence §Peer end. → scenario
4. Ordered-output bin emits `stdout A → stderr B → stdout C`, then exits;
   Worker-port frames and public runtime events retain that order before one
   toolchain result. Artifact: lifecycle evidence §Order. → scenario
5. Mechanism sweep compares Worker, host, PTY/project, package/stamp, npm, Git,
   TypeScript and OPFS mechanisms. Artifact: lifecycle evidence §Class sweep.
   → REV-7

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `concurrent-same-key` × install/run admission | one Worker-owned slot; rejected overlap has zero dispatch/effects and no queue | four-way held-boundary matrix → I2, I3 |
| `corrupt-input` + `observable-order` × request validation | exact snapshot before await/post/effect | readiness-held mutation matrix → I2, I3 |
| Worker peer death × admitted install/run | each promise rejects once; no hang/retry/rollback claim | six-case seam fault matrix → scenario |
| `observable-order` + `lossy-aggregate` × run output/result | exact cross-stream order, then one result after drain/flush | raw frame timeline → scenario |

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
- No claim that public `runtime.eval`/`fs` is serialized with toolchain calls.

## Decisions

review: checkpoints rounds:2
re-cut: 2026-09-03 — split successor of distribution/no-coi-sandbox-build-loop for five lifecycle proof HOLDS — trace: none
- 2026-09-03 — owns overlap non-dispatch, run-bin peer settlement, immutable input, stream/result order and ADR-0376 mechanism proof.
- 2026-09-02 — user override: retain these as one shared I2/I3 substrate.
