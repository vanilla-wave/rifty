---
area: runtime-js
status: parked
title: web globals + node:buffer module exports
created: 2026-06-20
why: globalThis.global alias is the highest-reach single unblock (pervasive CJS global.X ReferenceErrors); node:buffer module-level exports + var-width int accessors are browser-native re-exports / pure-JS, NOT covered by buffer-pending-statics (Buffer-CLASS statics only).
user_story: As a user running webpack-shimmed / process-polyfill / jest-style npm code, I want global.X and the full node:buffer surface, but today globalThis.global is undefined (ReferenceError) and node:buffer exports only {Buffer}.
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §7]
code: [packages/runtime-js/src/worker-entry.ts, packages/runtime-js/src/builtins/index.ts, packages/io/src/buffer.ts, packages/io/src/buffer-prototype.ts, packages/runtime-js/src/builtins/timers.ts]
---

## Context

Module-level node:buffer + global aliases, mostly native re-exports / pure-JS. buffer-pending-statics = Buffer-CLASS statics only, no overlap.

| feature · since | real path | anchor |
|---|---|---|
| **globalThis.global** (=globalThis · v12) HEADLINE | one-liner beside Buffer/process/timers | worker-entry.ts:38 |
| node:buffer Blob/File/atob/btoa/SlowBuffer | re-export browser-native (Blob/File repo-wide); SlowBuffer=allocUnsafeSlow alias; registers only {Buffer} | builtins/index.ts:73, buffer.ts:257 |
| isUtf8/isAscii | pure-JS byte-scan / TextDecoder fatal round-trip | buffer.ts:257 |
| resolveObjectURL · INSPECT_MAX_BYTES | real-or-loud: resolveObjectURL must back a real URL.createObjectURL registry or throw; INSPECT_MAX_BYTES must drive inspect truncation, else soft lie | — |
| readUIntLE/BE · readIntLE/BE (v0.11) | 1–6B loop over dvFor seam, sign-extend signed; installIntMethods installs only fixed 8/16/32 | buffer-prototype.ts:159 (dvFor:30) |
| writeUIntLE/BE · writeIntLE/BE (v0.11) | reader mirror; return offset+byteLength | buffer-prototype.ts:159 |
| toJSON (v0.9) | {type:'Buffer',data:Array.from(this)} | buffer-prototype.ts |
| copyBytesFrom (v18.16) | byte-window offset*BPE+length copied via set() (explicit-copy) | buffer.ts:257 |
| scheduler global (v22 exp) | install existing timersPromises.scheduler {wait/yield} on globalThis, reuse to avoid drift | builtins/timers.ts:228 |

## Options or Next

Parity-first, per-symbol promotable (each lands with its own failing parity test then impl). Start with `global` (S, highest reach), then int LE/BE read+write pairs (share the dvFor loop), then toJSON/copyBytesFrom/predicates, then scheduler. resolveObjectURL + INSPECT_MAX_BYTES gated: real backing or NotImplementedError — never silent.

## Reversibility

REVERSIBLE (recorded here). `global`/os-style constant additions = CHANGELOG line on land.
