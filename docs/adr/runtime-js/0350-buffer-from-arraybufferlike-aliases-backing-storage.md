# ADR 0350: Buffer.from ArrayBufferLike aliases backing storage

Status: Accepted
Date: 2026-08
Corrects: ADR-0030 `Buffer.from(arrayBuffer)` copy consequence and no-copy follow-up only

> TL;DR: `Buffer.from(ArrayBufferLike, offset?, length?)` aliases the supplied backing store; typed-array and array inputs still copy

> Correction 2026-08-11: omitting `length` creates a length-tracking view over
> resizable/growable backing stores; an explicit `length` creates a fixed-length view.

## Context

ADR-0030 made `Buffer` a real `Uint8Array` subclass but explicitly pinned
`Buffer.from(arrayBuffer)` to copy. That frozen assumption differs from Node. Webpack's
packaged MD4 is the forcing consumer: it creates a Buffer over
`WebAssembly.Memory.buffer`, then WASM writes the digest through that memory. A copied
Buffer retains stale pre-final bytes and compilation never completes correctly.

The Node boundary is broader than Webpack: raw `ArrayBuffer` and `SharedArrayBuffer`
inputs alias, including stores from another realm. Typed-array input instead copies.
Offset/length coercion, resize/grow, detach, and WebAssembly-memory growth are
observable parts of that ownership split.

## Decision

1. `Buffer.from(ArrayBufferLike, byteOffset?, length?)` returns a Buffer view over the
   supplied backing store. Mutations remain visible in both directions. Omitting
   `length` length-tracks a resizable/growable store; an explicit `length` is fixed.
2. Realm-safe intrinsic getters classify `ArrayBuffer` and `SharedArrayBuffer`; constructor
   identity is not an authority because backing stores may originate in another realm.
3. Offset/length coercion, bounds errors, detachment, and shared/unshared WASM-memory
   growth follow Node. Existing detached views stringify as empty; creating a new view
   over a detached store still throws.
4. `Buffer.from(Uint8Array | array)` continues to copy. `Buffer.copyBytesFrom()` remains
   the explicit TypedArray byte-window copy API.
5. ADR-0030's real subclass, prototype-method, `Symbol.species`, and brand decisions stay
   active. Only its raw-backing-store copy consequence and follow-up are corrected.

## Consequences

- WASM and other shared-storage consumers observe Node-compatible bytes without
  package-specific hashing or loader configuration.
- Callers that relied on rifty's incorrect copy observe mutations; preserving that bug
  is rejected.
- Unit and Node-parity cases pin ordinary/cross-realm stores, resizable/growable
  stores, typed-array copy, coercion/bounds, detach, and WASM grow behavior.
