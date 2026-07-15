---
area: kernel
status: ready
title: Opaque named capability ports on Worker bootstrap
created: 2026-07-15
why: owner-supervised Workers need dedicated async protocols, but kernel currently transfers only fixed stdio/IPC ports and its init failures are not rollback-safe
user_story: As a workspace owner supervising a Node Worker, I want to pass an explicit named MessagePort at bootstrap so a real capability can be ready before user code without leaking its protocol into kernel, env, or Node IPC
epic: honest-shadow-substitutions
blocked_by: []
sources: [docs/adr/kernel/0266-opaque-named-capability-ports-on-worker-bootstrap.md, docs/adr/kernel/0144-kernel-server-process-model-persistent-worker-processes-serve-replacing-the-keep-alive-hack.md, docs/adr/toolchain-build/0043-vite-in-worker-realm-and-cross-realm-preview-bridge.md]
code: [packages/kernel/src/spawn-worker.ts, packages/kernel/src/worker-entry.ts, packages/kernel/src/shared-globals.ts, packages/kernel/src/process-manager.ts, packages/kernel/src/index.ts, packages/kernel/tests/spawn-worker-singleton.test.ts, packages/kernel/tests/worker-entry-install.test.ts, packages/kernel/tests/worker-entry-serve.test.ts]
---

## Context

ADR-0266 owns the generic seam. `spawnKernelWorker` currently transfers four
fixed ports, attaches its dispatcher before init, and installs lifecycle
listeners only after `postMessage`. A synchronous init throw leaks the Worker,
ring, and ports. Child SAB attach/process publication also sit outside the
finalization catch. Shadow assets are the first consumer; no asset name or
frame belongs in kernel.

## Acceptance

- Kernel exports `capabilityPorts?: Readonly<Record<string, MessagePort>>` on
  `SpawnWorkerSpec`; `WorkerSpawnSpec` and `KernelProcessSpec` carry a required
  normalized snapshot. Absence is a frozen empty null-prototype record.
- Validate and snapshot before allocation: plain/null-prototype record, own
  enumerable exact non-empty names, `MessagePort` values, one port identity per
  name. Invalid input throws synchronous named `TypeError`; no Worker,
  dispatcher attach, transfer, close, or ownership change occurs.
- After validation kernel owns the child endpoints and transfers each exactly
  once with stdout/stderr/stdin/IPC. Caller mutation cannot alter init. Any
  later constructor/dispatcher/init-post failure terminates, detaches, closes
  every kernel-owned port exactly once, publishes no process, and rethrows.
- Child bootstrap reconstructs and publishes the normalized record through
  `KernelProcessSpec` before pre-entry and import. Kernel does not start ports,
  emit frames, or expose capabilities on Node `process`, env, stdio, fork IPC,
  `WorkerStdioPorts`, or `WorkerProcessHandle`.
- One child failure path covers SAB attach, publication, pre-entry, entry, and
  drain. Failed setup and run-to-completion close capability ports with stdio;
  clean `serve:true` retains them until hard termination. Caller-owned peer
  cleanup and protocol deadlines remain outside kernel.
- Spawns without capabilities preserve existing observable behavior. Correct
  the stale `WorkerSpawnSpec` transfer comment: SAB is shared, and four fixed
  ports—not three—are transferred.

## Observable proof

1. Kernel unit: two real named ports yield one immutable init snapshot and a
   transfer list with the existing four ports plus each capability exactly
   once; absent input publishes empty at every mirrored spec.
2. Validation/fault unit: each malformed shape fails before allocation. Throw
   Worker construction, dispatcher attach, and init post in turn; every
   adopted resource closes once and `ProcessManager` records nothing.
3. Bootstrap unit: pre-entry reads the named endpoint through
   `readKernelProcessSpec()` before entry. Fault SAB attach, publication,
   pre-entry, entry, and drain; exit/close ordering stays complete.
4. Real Chromium browser-unit: a page passes `port2` to a real kernel Worker;
   a protocol-free probe entry reads it from `KernelProcessSpec` and round-trips
   one frame through `port1`. Assets and source greps cannot close this proof.

## Parity cases

1. A spawn without capabilities has unchanged argv/env/cwd/process, stdio, exit,
   and `serve` behavior.
2. Capability names/frames never appear in Node `process.env`,
   `process.send`, or `process.on('message')`.
3. Entry/setup failure preserves the existing exit-code/stderr order while
   adding complete capability cleanup.

## Fault matrix

| Axis | Fault | Required outcome | Proof |
| --- | --- | --- | --- |
| `corrupt-input` | Non-record, empty name, non-port, or one port under two names | Synchronous named `TypeError`; no allocation, transfer, or adoption | Table-driven validation faults |
| `torn-state` | Worker construction, dispatcher attach, or init post throws | Terminate if created; detach ring; close stdio/IPC/capabilities once; original error; no process record | Throwing factory/dispatcher/Worker adapter |
| `observable-order` | Hook/import can run before publication | Full normalized record visible first; no env/IPC projection | Bootstrap order + Chromium probe |
| `torn-state` | Child attach/publication/pre-entry/entry/drain fails | Exit 1 and stderr when usable; all child ports close; realm reaped | Fault each bootstrap boundary |
| `sibling-drift` | Field disappears across the three specs | Exact name-to-endpoint mapping survives real transfer; absent stays empty | Shared contract + browser round-trip |

## Out of scope

- Capability framing, authentication, progress, cancellation, deadlines,
  backpressure, terminal errors, or peer request settlement.
- Caller peer start/session cleanup; each consuming module owns it.
- Transferables other than `MessagePort`.
- Same-realm spawn or automatic inheritance by descendants.
- Graceful protocol shutdown on hard `Worker.terminate()`.

## Decisions

- `capabilityPorts`, not unbounded `extraPorts`; names are opaque to kernel.
- One init post owns transfer and publication order.
- Kernel owns child endpoints after validation; caller owns peer sessions.
