---
area: runtime-js
status: draft
title: Buffer.allocUnsafe and Buffer.from(string) share Node's 8 KiB pool slab
created: 2026-11-26
why: Node hands small allocUnsafe/from(string) Buffers as views into one 8 KiB pool ArrayBuffer (byteOffset > 0, shared `.buffer`); in the isolate rifty allocates each one alone, so code reading `.buffer`/`byteOffset` sees other values
sources: [PR-469-external-review]
code: [packages/io/src/buffer.ts]
---

## Context

Found by the PR #469 external review (buffer ownership in `fs`). Measured 2026-11-26, Node v24.16.0
macOS arm64 vs rifty isolate (`runCode`, PR #469 head), program
`const a = Buffer.allocUnsafe(8), b = Buffer.allocUnsafe(8); console.log(a.buffer.byteLength, a.byteOffset, b.byteOffset, a.buffer === b.buffer, Buffer.from('ab').buffer.byteLength, Buffer.poolSize)`:
Node `8192 0 8 true 8192 8192`, rifty `8 0 0 false 2 undefined`. `io/buffer.ts` says it does not pool
(`allocUnsafeSlow` ≡ `allocUnsafe`); in-process the guest's `Buffer` draws from the pool it shares with the host process (PR #469
review; not re-run here). Not `buffer-pending-statics` (that is the `poolSize`
static only, no allocation behavior).

Trap for the implementer: a string write hands the store `Buffer.from(string)` without a copy
(`fs.ts` `writeFileImpl`, PR #469: "an encoded string is already ours"). If `from(string)` starts
drawing from a pool, the store keeps a slice of the pool slab, reachable by the guest through
`.buffer` of any later pooled Buffer — the aliasing PR #469 fixed, back. Copy pooled string bytes
there, and add a parity row (`fs.writeFileSync(p, 'abc'); Buffer.allocUnsafe(8).buffer` filled →
file intact). Owner: io Buffer. Trigger: a package reading `.buffer`/`byteOffset` of a small Buffer, or a
perf need for small allocations. No compat row yet.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
