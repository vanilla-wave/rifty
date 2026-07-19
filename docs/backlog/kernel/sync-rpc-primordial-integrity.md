---
area: kernel
status: draft
title: Sync RPC control frames are independent of guest-mutated primordials
created: 2026-07-19
why: kernel framing dynamically reads mutable realm globals and prototype methods, so Node-legal monkeypatches such as JSON.stringify replacement can corrupt host control traffic
user_story: As a developer running a package that monkeypatches JavaScript built-ins, I want its own behavior to change without corrupting Rifty's process and filesystem transport, but today a guest patch can alter or break sync RPC frames.
blocked_by: []
sources: [PR-153-post-merge-kernel-audit, Node-v24-global-mutation-parity]
code: [packages/kernel/src/ipc/sync-rpc.ts, packages/kernel/src/ipc/sab-ring.ts, packages/kernel/src/ipc/sync-dispatch.ts]
---

## Context

`sync-rpc.ts` captures encoder/decoder instances but still dynamically reads `JSON.stringify`/`JSON.parse`, typed-array methods, and byte-length accessors; `sab-ring.ts` dynamically reads `Atomics` methods and typed-array operations. In the shared runtime realm, a Node-legal global or prototype monkeypatch can therefore observe, alter, or stop Rifty control frames rather than affecting only the package's application behavior. The trust boundary is compatibility integrity, not hostile-code containment: Rifty does not promise a security sandbox.

## Refinement path

- Reproduce from a real loaded Node program and inventory every mutable intrinsic used from frame encode through SAB write/read, dispatch, reply encode, and client decode. Do not stop at the first `JSON.stringify` probe.
- RED parity for replacement of JSON functions, TextEncoder/TextDecoder methods, typed-array `slice`/`subarray`/`set` and byte-length access, and Atomics functions before and after runtime construction. Assert byte-exact requests/replies and guest-observable monkeypatch behavior against Node.
- Define the realm and capture point that owns kernel primordials, including worker startup and test injection. Avoid a security claim or a one-off local alias that leaves sibling control paths mutable.
- Keep absence of optional platform capabilities separate: the current `Atomics.waitAsync` fallback is not evidence for this mutation-integrity gap.
