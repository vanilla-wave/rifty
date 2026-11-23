---
area: kernel
status: draft
title: Sync RPC control frames are independent of guest-mutated primordials
created: 2026-10-25
why: kernel sync-RPC framing reads mutable realm intrinsics at call time, so a Node-legal guest monkeypatch (JSON.stringify, Uint8Array.prototype.set, Atomics.wait) alters or breaks rifty's own fs/process transport
user_story: As a developer running a package that monkeypatches JavaScript built-ins, I want only that package's behavior to change, but today the patch can forge, drop or time out rifty's sync fs/process control frames.
blocked_by: []
sources: [ADR-0294, ADR-0447, PR-158-salvage-probe-2026-10-25]
code: [packages/kernel/src/ipc/sync-rpc.ts, packages/kernel/src/ipc/sab-ring.ts, packages/kernel/src/ipc/sync-dispatch.ts, packages/kernel/src/ipc/sync-client.ts, packages/kernel/src/worker-entry.ts]
---

## Context

Salvaged from PR #158 (2026-07-19 audit draft); re-verified on main `7d038adb0`.

Mutable reads on the frame path (no primordial capture anywhere in kernel;
only the encoder/decoder instances are captured, `sync-rpc.ts:110-111`):

- `sync-rpc.ts`: `JSON.stringify` `:143`, `:256`; `JSON.parse` `:199`, `:245`;
  `TextEncoder#encode` `:147`, `:152`, `:260`; `Uint8Array#slice` `:124`,
  `:191`, `:237`; `#set` `:131`, `:164-165`; `#subarray` `:187`, `:233`;
  `DataView#setUint16`/`getUint16` `:163`, `:221`; `byteLength` getters.
- `sab-ring.ts`: `Atomics.load/store/compareExchange/notify` (e.g. `:213-217`,
  `:337-360`), `Atomics.wait` `:294`, `Atomics.waitAsync` `:44-47`,
  `bytes.set` `:274`, `:463`, `subarray` `:372`, `:439`, `performance.now` `:292`.
- `sync-dispatch.ts:362` (`instanceof Uint8Array`), `:416+` error shaping;
  `sync-client.ts:101-110` error rebuild.

Same realm as guest code: client built in the guest Worker global
(`worker-entry.ts:236`); child fs routes through it
(`runtime-js/src/ipc/sync-rpc-fs.ts`, `no-coi-child-transport.ts:114`); the
dispatcher singleton lives in the parent Node-process worker
(`runtime-js/src/builtins/child_process.ts:90`).

Probe (uncommitted scratch vitest over a real client + SAB ring, globals
restored):
patched `JSON.stringify` → dispatcher received a forged `{"method":"evil"}`
frame; patched `JSON.parse` → an `ENOENT` error reply decoded as
`{ok:true}`; no-op `Uint8Array.prototype.set` → frame lost, `SyntaxError` in
`decodeRequest`; `Atomics.wait = () => 'timed-out'` → infinite call failed
`RingTimeoutError`; patched `Uint8Array.prototype.slice` → binary reply
`[1,2,3]` decoded `[9,9]`. Node 24's `fs.readFileSync` is unaffected by these
patches. Precedent: runtime-js module loader captures primordials
(`loader.ts:84-87`, `cjs.ts:24-30`; ADR-0294); ADR-0447 names a kernel
primordial seam as not yet built.

Trust boundary is compatibility integrity, not a security sandbox. Absent
optional capabilities (`Atomics.waitAsync` fallback) are a separate axis.
Related, distinct seam: `runtime-js/no-coi-toolchain-run-builtin-state-leak`.

## Question

Which realm and capture point own kernel primordials (Worker startup, test
injection) so every frame encode → ring → dispatch → reply → decode read is
pinned, not a one-off alias? Settled at PICKUP with RED cases for each
intrinsic family above, before and after runtime construction.
