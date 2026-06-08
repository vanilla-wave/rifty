# ADR 0030: Buffer extends Uint8Array (real subclass, Symbol.species)

Status: Accepted
Date: 2026-05

## Context

The prior `@riftydev/io` Buffer (ADR-0012, promoted from `runtime-js`) used a factory: `Buffer.from()` returned a `Uint8Array` stamped per-instance with helpers via `Object.defineProperty` plus a `Symbol.for('nodejs.Buffer')` brand; `Buffer.isBuffer` checked the brand. This silently failed where real packages rely on Node's typed-array protocol:

- `buf.subarray(...)` returns a plain `Uint8Array` (brand/helpers are per-instance, not on a prototype), so `Buffer.isBuffer(buf.subarray())` is `false` and `.toString('utf8')` falls through to `Uint8Array.prototype.toString` (comma-joined byte ints).
- `buf instanceof Buffer` was meaningless — `Buffer` was a plain object, not a class.
- Structured clone / `postMessage` across a worker drops the per-instance descriptors; receiver sees a plain `Uint8Array`.
- `JSON.stringify(buf)` and other tooling assume Node's prototype-method shape.

Node has `Buffer extends Uint8Array` and uses `Symbol.species` to keep `subarray`/`slice` returning `Buffer`.

## Decision

Make `Buffer` a real subclass of `Uint8Array`. All Node-compatible methods live on `Buffer.prototype`. `Symbol.species` returns `Buffer` so derived typed-array ops preserve the brand. `Buffer.isBuffer(v)` collapses to `v instanceof Buffer`.

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

Installers live in separate files (`buffer-prototype-core.ts`, `-int.ts`, `-extra.ts`) so no file exceeds the ADR-0024 300-line budget. Each uses declaration-merging (`declare module './buffer.ts' { interface Buffer { ... } }`) to surface its methods on the class shape.

## Consequences

- `buf.subarray(...)` / `buf.slice(...)` return Buffer-typed views; `Buffer.isBuffer(buf.subarray(1, 4))` works, and `toString`/`equals`/etc. carry through via the prototype.
- `instanceof Buffer` is meaningful; `Buffer.isBuffer` is a one-liner.
- Structured clone over a worker preserves the brand IF the receiver's globals have `Buffer` on their prototype (V8 walks the chain on reconstruction). We control both ends at rifty's worker boundaries; bare browser-worker boundaries (rare) may still see `Uint8Array` — acceptable since `instanceof Uint8Array` holds.
- `Buffer.from(uint8)` copies (Node semantics). `Buffer.from(arrayBuffer)` also copies; Node returns a view onto the same backing buffer — low-priority follow-up, no consumer hit yet.
- Install order matters: the class must be declared before methods install (handled by top-of-file imports triggering `installXxx` at module-evaluation time).

## Follow-ups

- Buffer pool / `Buffer.poolSize` — Node uses an 8KB internal pool for short `Buffer.allocUnsafe`; not implemented (we `new Buffer(size)`). Perf pass after M10 if packages hot-path it.
- `Buffer.transcode(...)` between encodings — still `❌` (deferred).
- ArrayBuffer-from no-copy (zero-copy view) — deferred.

## Acceptance criteria

- [x] `class Buffer extends Uint8Array` lands in `packages/io/src/buffer.ts`.
- [x] All prototype methods covered by `installCore/Int/Extra` helpers.
- [x] `Symbol.species` returns `Buffer`.
- [x] `Buffer.isBuffer` is `instanceof Buffer`.
- [x] Parity case `buffer/extends-uint8array.case.ts` matches Node: `subarray()` returns a Buffer; `.toString('utf8')` honors the encoding overload; `slice()` returns a Buffer.
- [x] All existing Buffer unit + parity tests still pass.
- [x] No file in the package exceeds the ADR-0024 line budget.
- [x] `docs/compat/buffer.md` no longer lists `subarray`/`copyWithin` as partial.
