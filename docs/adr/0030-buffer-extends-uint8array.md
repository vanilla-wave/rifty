# ADR 0030: Buffer extends Uint8Array (real subclass, Symbol.species)

Status: Accepted
Date: 2026-05

## Context

The earlier `@riftydev/io` Buffer (ADR-0012 promoted it from `runtime-js`) used a
factory pattern: `Buffer.from()` returned a `Uint8Array` stamped with the
Buffer-style helpers via `Object.defineProperty`, plus a `Symbol.for('nodejs.Buffer')`
brand on the instance. `Buffer.isBuffer` checked the brand.

This worked for the happy path but silently failed in several cases real npm
packages depend on:

- `buf.subarray(...)` returns a plain `Uint8Array` (the brand and helpers are
  per-instance, not on a prototype). `Buffer.isBuffer(buf.subarray())` is
  `false`. Calls like `.toString('utf8')` on the result fall through to
  `Uint8Array.prototype.toString`, which prints comma-joined byte ints.
- `buf instanceof Buffer` was meaningless because `Buffer` was a plain object,
  not a class.
- Structured clone / `postMessage` over a worker drops the per-instance
  property descriptors, so the receiving side sees a plain `Uint8Array`.
- `JSON.stringify(buf)` and other tooling assume the prototype-method shape
  Node provides; the per-instance stamping diverged.

Node's actual implementation has `Buffer extends Uint8Array` and uses
`Symbol.species` to keep `subarray`/`slice` returning `Buffer`. Packages
written against Node's typed-array protocol expect that.

## Decision

Make `Buffer` a real subclass of `Uint8Array`. All Node-compatible methods
live on `Buffer.prototype`. `Symbol.species` returns `Buffer`, so derived
typed-array operations preserve the brand.

Implementation pattern:

```ts
export class Buffer extends Uint8Array {
  static get [Symbol.species]() { return Buffer; }
  static from(...): Buffer { ... }
  static alloc(...): Buffer { ... }
  // ...
}
installCoreMethods(Buffer);   // toString, equals, write, swap, compare
installIntMethods(Buffer);    // read/writeInt{8,16,32}, BigInt64
installExtraMethods(Buffer);  // float/double, indexOf, fill, copy
```

The prototype-method installers live in separate files
(`buffer-prototype-core.ts`, `-int.ts`, `-extra.ts`) so no single file passes
the ADR-0024 300-line budget. Each installer also uses TypeScript
declaration-merging (`declare module './buffer.ts' { interface Buffer { ... } }`)
to surface its methods as part of the class shape.

`Buffer.isBuffer(v)` collapses to `v instanceof Buffer`.

## Consequences

- `buf.subarray(...)` and `buf.slice(...)` return Buffer-typed views — packages
  doing `Buffer.isBuffer(buf.subarray(1, 4))` work as expected. `toString` /
  `equals` / etc. carry through automatically because they live on the
  prototype.
- `instanceof Buffer` is meaningful. `Buffer.isBuffer` is now a one-liner.
- Structured clone of a `Buffer` over a worker preserves the brand IF the
  receiver's globals have `Buffer` on their prototype (V8 walks the prototype
  chain when reconstructing). Within rifty's own worker boundaries we control
  both ends; bare browser-worker boundaries (rare in our flow) may still see
  Uint8Array — acceptable because `instanceof Uint8Array` still holds.
- `Buffer.from(uint8)` still copies (Node semantics). `Buffer.from(arrayBuffer)`
  also copies in our impl; Node returns a view onto the same backing buffer.
  Recorded as a low-priority follow-up; no real consumer hit yet.
- Prototype install order matters: the class must be declared before its
  methods are installed (TypeScript handles this via top-of-file imports
  triggering the `installXxx` calls at module-evaluation time).

## Follow-ups

- Buffer pool / `Buffer.poolSize` — Node uses an 8KB internal pool for short
  `Buffer.allocUnsafe` calls. Not implemented; we just `new Buffer(size)`.
  Performance pass after M10 if packages start hot-pathing this.
- `Buffer.transcode(...)` between encodings — still `❌` (deferred).
- ArrayBuffer-from no-copy path (zero-copy view) — deferred.

## Acceptance criteria

- [x] `class Buffer extends Uint8Array` lands in `packages/io/src/buffer.ts`.
- [x] All prototype methods covered by `installCore/Int/Extra` helpers.
- [x] `Symbol.species` returns `Buffer`.
- [x] `Buffer.isBuffer` is `instanceof Buffer`.
- [x] Parity case `buffer/extends-uint8array.case.ts` matches Node:
  `subarray()` returns a Buffer; `.toString('utf8')` honors the encoding
  overload; `slice()` returns a Buffer.
- [x] All existing Buffer unit + parity tests still pass.
- [x] No file in the package exceeds the ADR-0024 line budget.
- [x] `docs/compat/buffer.md` no longer lists `subarray`/`copyWithin` as
  partial.
