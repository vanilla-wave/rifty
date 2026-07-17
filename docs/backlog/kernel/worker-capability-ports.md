---
area: kernel
status: ready
title: Opaque named capability ports on URL Worker entries
created: 2026-07-15
why: owner-supervised Worker entries need dedicated async protocols, while kernel has only fixed stdio/IPC ports and remaining parent/child bootstrap faults can leak newly adopted endpoints
user_story: As a workspace owner supervising a Worker entry, I want to pass explicit named MessagePorts before entry code without leaking their protocols into kernel, process identity, env, or Node IPC
epic: honest-shadow-substitutions
blocked_by: []
sources: [docs/adr/kernel/0266-opaque-named-capability-ports-on-worker-bootstrap.md, docs/adr/runtime-js/0267-entry-scoped-host-bootstrap-metadata-for-recursive-node-workers.md, docs/adr/kernel/0144-kernel-server-process-model-persistent-worker-processes-serve-replacing-the-keep-alive-hack.md, docs/adr/toolchain-build/0043-vite-in-worker-realm-and-cross-realm-preview-bridge.md]
code: [packages/kernel/src/spawn-worker.ts, packages/kernel/src/worker-entry.ts, packages/kernel/src/shared-globals.ts, packages/kernel/src/process-manager.ts, packages/kernel/src/index.ts, packages/kernel/tests/spawn-worker-init-failure.test.ts, packages/kernel/tests/worker-entry-bootstrap.test.ts, packages/kernel/tests/spawn-worker-singleton.test.ts, packages/kernel/tests/worker-entry-install.test.ts, packages/kernel/tests/worker-entry-serve.test.ts]
---

## Context

ADR-0267 has landed: URL entries already carry opaque `bootstrap` metadata and
publish it before pre-entry. ADR-0266 adds a sibling entry-scoped transferable
record without changing `KernelProcessSpec`.

Fresh `main` already rolls back Worker, dispatcher ring, and eight fixed
endpoints when init `postMessage` throws. Preserve that RED/GREEN regression.
The remaining transaction boundaries are validation, SAB/fixed-channel/Worker
construction, dispatcher/listener installation, and child attach/publication.
Shadow assets are the first consumer; no asset name or frame belongs in kernel.

## Acceptance

- Add `capabilityPorts?: Readonly<Record<string, MessagePort>>` only to the URL
  `WorkerEntryDescriptor` variant. `SpawnWorkerSpec.entry` carries it and
  `WorkerSpawnSpec.entry` receives a normalized snapshot.
  `KernelProcessSpec`, source entries, `WorkerStdioPorts`, and
  `WorkerProcessHandle` do not gain the field.
- Validate before allocation: plain/null-prototype record; own enumerable
  string data properties; exact non-empty names; `MessagePort` values; one port
  identity per name. Accessor, enumerable symbol, bad value, or duplicate
  identity throws synchronous named `TypeError` with no construction, transfer,
  close, or ownership change.
- After validation kernel owns the child endpoints. Caller mutation cannot
  alter the normalized entry. Transfer each exactly once in the one init list
  after stdout/stderr/stdin/IPC.
- Make parent spawn failure-atomic from the first post-validation allocation
  through all lifecycle listeners. Fault SAB creation, each fixed
  `MessageChannel` construction, Worker construction, dispatcher attach, init
  post, and each listener add. Close only resources actually acquired, detach
  only when attached, terminate only when constructed, publish no process, and
  rethrow the first error. Cleanup failures never replace it.
- Preserve the existing init-post regression and extend it to assert four fixed
  plus N capability transfers and eight fixed plus N adopted endpoint closes.
- Child bootstrap publishes one frozen null-prototype record through
  `readKernelEntryCapabilityPorts()` before pre-entry/import. URL-without-ports
  and source entries publish empty, clearing stale test state. ADR-0267
  `readKernelEntryBootstrap()` and `readKernelProcessSpec()` remain separate.
- One child guard/finalizer covers SAB attach, sync/process/bootstrap/capability
  publication, pre-entry, import, and drain. Setup failure exits 1, writes
  stderr when usable, closes fixed/capability ports, and reaps the realm. Clean
  run-to-completion closes them; clean `serve:true` retains them until hard
  termination.
- Kernel never starts ports, emits frames, interprets names, exposes them on
  Node state, or inherits them automatically. Caller peer lifecycle and
  protocol deadlines remain above kernel.
- Spawns without capabilities preserve current argv/env/cwd/process, stdio,
  exit, and `serve` behavior. Correct the stale `WorkerSpawnSpec` comment: SAB
  is shared and four fixed ports, not three, are transferred.

## Observable proof

1. Contract unit: two real named ports produce one immutable URL-entry snapshot
   and a transfer list containing the four fixed endpoints plus each capability
   once. Type/shape tests reject capabilities on source entries and
   `KernelProcessSpec`; absent reads frozen empty.
2. Validation unit: every malformed record/key/descriptor/value/duplicate fails
   before allocation and leaves caller ownership intact.
3. Parent fault tests: inject every construction/attach/post/listener fault;
   every acquired resource settles once, the original error survives, and
   `ProcessManager` records nothing. The fresh-main init-post test remains green.
4. Child fault tests: pre-entry reads both ADR-0267 bootstrap and the independent
   capability snapshot. Fault SAB attach and every publication/lifecycle
   boundary; exit/stderr/close ordering remains complete.
5. Real Chromium browser-unit: a page gives `port2` to a real kernel URL entry;
   the entry reads it via `readKernelEntryCapabilityPorts()` and round-trips one
   protocol-free frame through `port1`. Source greps cannot close this proof.

## Parity cases

1. A spawn without capabilities has unchanged observable process and lifecycle
   behavior.
2. Capability names/frames never appear in `process.env`, `process.send`,
   `process.on('message')`, stdio, or `KernelProcessSpec`.
3. Entry/setup failure preserves current exit-code/stderr order while adding
   complete capability cleanup.

## Fault matrix

| Axis | Fault | Required outcome | Proof |
| --- | --- | --- | --- |
| `corrupt-input` | Non-record/accessor/symbol/empty name/non-port/duplicate identity | Synchronous named `TypeError`; no allocation or adoption | Table-driven validation faults |
| `torn-state` | SAB/channel/Worker/dispatcher/post/listener step throws | Roll back only acquired resources once; original error; no process | Inject every parent boundary |
| `observable-order` | Hook/import runs before entry publication | Bootstrap and capability snapshots visible first; process spec stays separate | Bootstrap order + Chromium probe |
| `torn-state` | Child attach/publication/pre-entry/import/drain fails | Exit 1, stderr when usable, all child ports close, realm reaped | Fault every child boundary |
| `sibling-drift` | Capability leaks into process/bootstrap or disappears on transfer | Separate accessors; exact real round-trip; absent stays empty | Contract + browser proof |

## Out of scope

- Capability framing, authentication, progress, cancellation, deadlines,
  backpressure, terminal errors, or peer request settlement.
- Caller peer start/session cleanup; each consumer owns it.
- Transferables other than `MessagePort`.
- Same-realm spawn, source-entry capabilities, or automatic descendant
  inheritance.
- Graceful protocol shutdown on hard `Worker.terminate()`.

## Decisions

- Entry-scoped `capabilityPorts`, not process metadata or unbounded
  `extraPorts`.
- One init post owns transfer and publication order.
- Kernel owns child endpoints after validation; caller owns peer sessions.
