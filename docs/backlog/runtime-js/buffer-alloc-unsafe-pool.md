---
area: runtime-js
status: draft
title: Buffer.allocUnsafe and Buffer.from(string) share Node's 8 KiB pool slab
created: 2026-11-26
why: Node hands small allocUnsafe/from(string) Buffers as views into one 8 KiB pool ArrayBuffer (byteOffset > 0, shared `.buffer`); rifty allocates each one alone, so code reading `.buffer`/`byteOffset` or relying on pool reuse sees other values
sources: [PR-469-external-review]
code: [packages/io/src/buffer.ts]
---

## Context

Found by the PR #469 external review (buffer ownership in `fs`). Measured 2026-11-26, Node v24.16.0
macOS arm64 vs rifty isolate (`runCode`, PR #469 head), program
`const a = Buffer.allocUnsafe(8), b = Buffer.allocUnsafe(8); console.log(a.buffer.byteLength, a.byteOffset, b.byteOffset, a.buffer === b.buffer, Buffer.from('ab').buffer.byteLength, Buffer.poolSize)`:
Node `8192 0 8 true 8192 8192`, rifty `8 0 0 false 2 undefined`. `io/buffer.ts` says it does not pool
(`allocUnsafeSlow` ≡ `allocUnsafe`). Not `buffer-pending-statics` (that is the `poolSize` static
only, no allocation behavior). The `fs` buffer-ownership parity rows already write from pooled
Node Buffers (`fs/write-read-buffer-ownership`), so a pool would not reopen the aliasing fixed
there. Owner: io Buffer. Trigger: a package reading `.buffer`/`byteOffset` of a small Buffer, or a
perf need for small allocations. No compat row yet.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
