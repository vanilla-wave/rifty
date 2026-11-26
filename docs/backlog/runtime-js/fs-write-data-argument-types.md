---
area: runtime-js
status: draft
title: fs write data that is not string or ArrayBufferView throws ERR_INVALID_ARG_TYPE, and writeSync takes any ArrayBufferView, as in Node
created: 2026-11-26
why: rifty's writeFileSync throws a code-less TypeError for a number/null and writes an Array/ArrayBuffer as wrong bytes where Node throws ERR_INVALID_ARG_TYPE; writeSync rejects a Uint16Array Node writes
sources: [tools/node-parity-runner/cases/fs/write-read-buffer-ownership.case.ts]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

Found 2026-11-26 by the buffer-ownership fix (branch `fix/fs-store-aliases-caller-buffer`, which makes
`writeFileSync` copy the raw bytes of any ArrayBufferView). Node v24.16.0 vs rifty in-process at that
branch (runtime-js `fs` over `MemoryFsSync`, tsx):

| call | Node | rifty |
|---|---|---|
| `writeFileSync(p, 123)` | `ERR_INVALID_ARG_TYPE` `The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received type number (123)` | `TypeError: next.slice is not a function`, no code |
| `writeFileSync(p, null)` | same, `Received null` | `TypeError: Cannot read properties of null (reading 'slice')`, no code |
| `writeFileSync(p, [1, 2])` | same, `Received an instance of Array` | writes 1,2 |
| `writeFileSync(p, new ArrayBuffer(2))` | same, `Received an instance of ArrayBuffer` | writes 0,0 |
| `writeSync(fd, new Uint16Array([0x0201]))` | writes 1,2 | `TypeError: data must be a string or Uint8Array`, no code |

Node validates `writeFile`'s data synchronously, also in the callback form (a throw, not an error
callback). Not `fs-path-invalid-arg-type` (paths). Owner: runtime-js fs. Trigger: a package passing
such data or branching on the code. Compat: `fs.md` ⚠️ row.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
