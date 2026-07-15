---
area: runtime-js
status: draft
title: kernel worker_threads prompt start while parent blocks in Atomics.wait
created: 2026-07-15
why: Node starts a Worker far enough that an immediate SAB message can wake a parent already blocked in Atomics.wait; rifty times out because child entry loading still needs the blocked parent's remote-FS dispatcher
user_story: As a pthread-style library that posts shared memory to a new Worker and immediately waits, I want the child to notify me like Node instead of timing out.
sources: [Node-v24-oracle, real-COI-rifty-reproduction, ADR-0270]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/kernel/src/spawn-worker.ts]
---

## Context

Real differential reproduction in a COI browser:

1. child waits for a `SharedArrayBuffer` on `parentPort`, then stores + notifies;
2. parent constructs `Worker`, posts the buffer, and immediately calls
   `Atomics.wait(..., 2000)`;
3. Node v24 returns `ok`; rifty returns `timed-out`.

Calling `globalProcessManager.spawnWorker` inside the constructor does not close
the behavior. The nested worker exists, but loading its guest entry requires a
sync remote-FS request served by the now-blocked parent realm. A spawn-call spy
therefore measures an internal order, not Node prompt-start parity.

This is separate from the Vite 8 failure fixed by ADR-0270: that fault was one
parent frame delivered twice. Workbench Vite A→B→A does not block its parent on
this handshake.

## Acceptance

- One browser test runs the same SAB program in Node v24 and a real COI rifty
  kernel Worker; both return `ok`, with no mocked spawn or VFS boundary.
- Child startup through the first message/notify cannot require progress from
  the blocked parent realm.
- `online`, `message`, and construction faults retain Node-observable ordering.
- Same-realm fallback stays an explicit non-parallel divergence.

## Options or Next

Refine the startup boundary before implementation. Candidate designs include
owner-independent initial entry delivery or a clone-safe initial payload that
lets the child reach its listener without parent-serviced remote-FS RPC. Do not
accept synchronous allocation alone as proof.

## Reversibility

REVERSIBLE internally; any new public Worker option or bootstrap wire shape
requires an ADR before implementation.
