# Changelog

## [Unreleased]

### Changed

- **ADR-0030:** `Buffer` is now a real subclass of `Uint8Array`. Prototype
  methods (toString, equals, write, swap, compare, copy, fill, indexOf,
  read/write{Int,UInt,Float,Double,BigInt}*) moved from per-instance
  `Object.defineProperty` stamping to `Buffer.prototype`. `Symbol.species`
  returns `Buffer`, so `buf.subarray()` and `buf.slice()` preserve the brand
  and `Buffer.isBuffer(buf.subarray())` is now `true` (matched Node).
  `Buffer.isBuffer(v)` collapses to `v instanceof Buffer`. The
  `buffer-methods{,-int,-extra}.ts` files were replaced by
  `buffer-prototype-{core,int,extra}.ts` (each declaration-merges the method
  shape onto the class).
- `BufferMethods` type alias removed from the public API — the method surface
  now lives directly on the `Buffer` class shape. Consumers that imported
  `BufferMethods` should import `Buffer` (the class) instead.

### Fixed

- `Writable` no longer emits `'drain'` after every write that drops below
  `highWaterMark`. Per Node's protocol, `'drain'` fires only when a prior
  `write()` returned `false` (HWM tripped). A new internal `needDrain` flag
  gates the emit; small writes under HWM never raise `'drain'`. Parity case
  `stream/writable-drain.case.ts` covers both branches.
- `once(emitter, name)` now defensively removes both listeners on both
  resolve and reject paths (was relying on the auto-removing `once()`
  registration plus a single-direction `off`; defensive removal in both
  directions is hygiene against future drift). New unit tests in
  `event-emitter.test.ts` assert `listenerCount === 0` after each path.

### Added

- `NotImplementedError` helper exported for cross-package use.
- **ADR-0012:** promoted the shared Node-compatible primitives into this package as the source of truth:
  - `EventEmitter` + `once()` promise helper (`src/event-emitter.ts`).
  - `Buffer` factory + per-instance method patching (`src/buffer.ts`, split across `src/buffer-codec.ts` and `src/buffer-methods.ts`).
  - Stream primitives — `Readable`, `Writable`, `Duplex`, `Transform`, `PassThrough`, plus `pipeline` and `finished` — under `src/streams/`.
  - `runtime-js`, `kernel`, and `net` now import these from `@rifty/io`; their previous in-package copies became re-export shims.
- `Buffer.write(s, offset?, length?, encoding?)` now honors both the `length`
  truncation and the `encoding` argument (utf8, utf16le, hex, ascii, latin1,
  base64, base64url). Previously both were silently ignored — utf8 was always
  used and `length` had no effect.
- `Buffer.alloc(size, fill, encoding)` now honors `encoding` for a string fill
  and tiles the encoded bytes across the full `size` (matching Node).
- Added `utf16le` / `utf-16le` / `ucs2` / `ucs-2` to the encoding enum (both
  `encode` and `decode`).
- New Buffer instance methods (real implementations, not stubs):
  `readFloatBE/LE`, `readDoubleBE/LE`, `writeFloatBE/LE`, `writeDoubleBE/LE`,
  `indexOf`, `lastIndexOf`, `includes`, `fill`, `copy`. Split into
  `src/buffer-methods-extra.ts` to stay under ADR-0024 line budget.
- `EventEmitter.rawListeners(name)` now returns the stored wrapper entries
  (matching Node — for `once(name, fn)` registrations, returns the wrapper
  whose `.listener` points to the original); `listeners(name)` continues to
  return unwrapped originals. `removeListener(name, fn)` now finds a
  `once()`-wrapped listener by `.listener` reference.
- New compat doc: `docs/compat/buffer.md`.
- New unit tests under `packages/io/src/` for both Buffer and EventEmitter
  behaviours. New parity cases under `tools/node-parity-runner/cases/`.

### Fixed

- The private `EventEmitter#listeners` instance-field name was shadowing the
  prototype `listeners()` accessor, making the Node-compatible
  `ee.listeners(name)` call un-invokable. Renamed the field to `listenersMap`
  and exposed `listeners()` as a normal method.
