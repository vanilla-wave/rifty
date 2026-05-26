# Changelog

## [Unreleased]

### Added

- **ADR-0036: preview-protocol addressing module.** New module
  `src/preview-protocol.ts` owns the `/preview/<port>/...` URL convention
  and the synthetic `preview.local` host shared between
  `@rifty/service-worker` (SW-side intercept) and `@rifty/net` (port
  registry). Public surface: `PREVIEW_PREFIX_RE`, `PREVIEW_LOCAL_HOST`,
  `synthesizePreviewUrl(path)`, `parsePreviewPath(path)` — all re-exported
  from `src/index.ts`. Closes the silent-drift hazard between the SW's
  inlined regex and the `net.registry` doc-comment cross-reference;
  future routing-scheme changes are a single-edit change here.
  Orthogonal to ADR-0031 (`SW_PROTOCOL_VERSION` on every wire frame) —
  that pins the *frame format*, this pins the *addressing scheme*. New
  unit suite `src/preview-protocol.test.ts` pins the regex, host literal,
  URL synthesis, and the suffix-default behaviour (`/preview/<port>`
  with no trailing slash returns `rest: '/'`).

- **ADR-0035: `node:` builtin registry.** New module
  `src/builtin-registry.ts` holds the process-wide `name → factory` cache
  that backs `node:<name>` lookups. Public surface: `registerBuiltin`,
  `loadBuiltin`, `isBuiltinSpecifier`, `listBuiltins`, and the
  `BuiltinFactory` type, re-exported from `src/index.ts`. Implementation
  moved verbatim from `@rifty/runtime-js/src/builtins/registry.ts` — same
  cache semantics, same `node:` prefix stripping, same re-register clears
  cache behaviour. The move closes the `@rifty/net → @rifty/runtime-js`
  reverse import that survived ADR-0012; both packages now reach the
  registry through `@rifty/io` (forward-only). See ADR-0035 for the
  rationale and alternatives.

- `Readable.from(iterable, options?)` now accepts a second
  `ReadableOptions` argument and detects byte vs object mode from the first
  chunk when `options.objectMode` is not supplied: an iterable of
  `Buffer`/`Uint8Array`/`string` chunks yields a byte-mode stream, an
  iterable of objects (or an async iterable, which we can't peek
  synchronously) yields an object-mode stream. Explicit `options.objectMode`
  always wins. `highWaterMark` and `encoding` are forwarded. Non-iterable
  input now throws `TypeError` synchronously (Node contract: bad input
  surfaces before any state is created). Both sync and async iterables are
  accepted via separate code paths (no implicit cast). New unit suite
  `readable.from.test.ts` plus parity case `stream/readable-from-options.case.ts`.
  Note: Node always defaults `objectMode` to `true` regardless of element
  type; rifty's detection diverges intentionally per the 2026-05-26 streams
  review — explicit `options.objectMode` is the cross-runtime portable path.

- `Readable.unpipe(dest?)` — detach a single `pipe(dest)` wiring or all of
  them. Mirrors Node's `Readable.prototype.unpipe`. `pipe(dest)` now also
  installs symmetric error wiring (source-error tears down the dest hooks,
  dest-error / dest-close tears down the source hooks) and tracks per-dest
  cleanup in a `Map<PipeableWritable, () => void>`, so listener counts
  return cleanly to zero on every termination path. The `opts.end` option
  is honoured: `pipe(dest, {end:false})` no longer calls `dest.end()` on
  source `end`. Subsequent `pipe(dest, …)` calls to the same destination
  replace the existing wiring (the old cleanup runs first), so
  `unpipe(dest)` removes all of this Readable's wirings to that destination
  in one call. New unit suite `readable.pipe.test.ts` plus parity case
  `stream/pipe-unpipe.case.ts`.

### Fixed

- `Readable[Symbol.asyncIterator]` now removes the `data`/`end`/`error`
  listeners it attaches on every termination path — natural EOF, consumer
  `break`/`return`, or consumer `throw`. The iterator is hand-rolled (rather
  than `async function*`) so its `return()` and `throw()` hooks run the same
  cleanup. On early termination (before the consumer drained everything) the
  source is `pause()`d and `destroy()`ed, matching Node's iterator semantics
  so producers learn the consumer is gone. The "drained vs early-terminated"
  test is tracked via a `naturallyDrained` flag that's set only when `next()`
  returned `{done:true}` — distinguishing the case where the consumer
  finished the iteration from the case where the source happened to emit
  `end` before the consumer broke out. Previously `for await` left listeners
  attached after the loop; repeated iteration and early `break` both leaked.
  New unit suite `readable.async-iterator.test.ts` plus parity case
  `stream/async-iterator-cleanup.case.ts`.

### Changed

- **ADR-0034 (D-B, IRREVERSIBLE):** `@rifty/io` stream primitives restored
  to Node's documented contract in one PR per the 2026-05-26 architecture
  review's Tier 1 #5. Five behavioural changes:
  - `EventEmitter.removeListener(event, listener)` now emits the synchronous
    `'removeListener'` meta-event after detaching the listener (suppressed
    when removing a `'removeListener'` listener itself to avoid infinite
    recursion). Node's `Stream.pipe()` cleanup machinery depends on this.
  - `Readable._readableState` field-bag added (Node `internal/streams/state.js`
    shape). `read(n)` now honours the requested size — exact-`n` slicing
    across queued Buffer entries via a new `sliceBuffer` helper, `n === 0`
    peek semantics, `n === undefined` "everything available" coalescing,
    and proper EOF transition (final `'readable'` then `'end'`). `flow()`
    pumps `_read` between flushes so flowing-mode keeps demand on the
    source. `push(chunk)` after EOF emits `'error'` (Node's
    "stream.push() after EOF" check). Public read-only accessors
    `readable`, `readableHighWaterMark`, `readableObjectMode`,
    `readableLength`, `readableEnded`, `destroyed` mirror Node's getters.
  - `Writable._writableState` field-bag added. `destroy(err?)` now flips
    `state.destroyed` synchronously, snapshots and errors the buffered-write
    queue (callbacks invoked with `err` on the next microtask), and rejects
    subsequent `write()` calls with the destroy error (returns `false`
    synchronously, schedules `cb(err)`). The in-flight `drainBuffer` callback
    checks `state.destroyed` before its success path so a `_write` that
    runs concurrent with `destroy()` doesn't emit `'drain'`/`'finish'`
    against a destroyed stream. Public read-only accessors `writable`,
    `writableHighWaterMark`, `writableObjectMode`, `writableLength`,
    `writableEnded`, `writableFinished`, `destroyed` mirror Node's getters.
  - `Duplex.prototype.write` / `Duplex.prototype.end` /
    `Duplex.prototype.destroy` now live on the prototype — no per-instance
    rebinding in the constructor. `writableSide` is now `readonly`.
    `Transform` constructor uses a new protected hook
    `DuplexInternalOptions._internalWritableSide` (factory) to inject its
    own `Writable` side wired to `_transform`/`_flush`, with a ref-cell
    back-filled after `super(...)` returns so the writable-side callbacks
    can reach the `Transform` for `push()`. `Object.getPrototypeOf(d).write
    === Duplex.prototype.write` now holds (matches Node).
  - `pipeline()` now calls `destroy(err)` on every other stage when any
    stage errors (Node's `cleanup` contract). Per-stage error absorbers
    installed at pipeline start; on first error, they trigger the destroy
    chain and stay attached for one microtask pass to absorb the
    deferred `'error'` emits from `destroy()`. When a callback is supplied,
    the returned promise gets a no-op `.catch()` so unhandled-rejection
    noise doesn't escape (callback IS the user's error path).

  Five new parity cases added under `tools/node-parity-runner/cases/`:
  - `events/remove-listener-meta.case.ts`
  - `stream/readable-read-n.case.ts`
  - `stream/writable-destroy.case.ts`
  - `stream/duplex-prototype-methods.case.ts`
  - `stream/pipeline-destroy-upstream.case.ts`

  Two existing unit tests updated under the ADR's explicit carve-out for
  ADR-boundary contract changes (CLAUDE.md hard rule "never modify a test
  to make code pass" still applies; this is the canonical exception). See
  ADR-0034 "Tests updated under this ADR's authorization" for the
  per-file diff summary.

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

- `EventEmitter.prependListener` and `prependOnceListener` now emit the
  `'newListener'` meta-event before adding the listener, matching Node's
  contract (previously only `addListener`/`on`/`once` emitted it; the prepend
  variants silently skipped the hook). The pre-emit logic was extracted into a
  private `emitNewListener` helper so both insertion paths produce identical
  semantics. New unit cases under `event-emitter.test.ts` pin the behaviour.
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
- Stream primitives now have a dedicated unit-test suite under
  `packages/io/src/streams/`:
  - `pipeline.test.ts` — Readable -> Transform -> Writable happy path,
    `pipeline()` error propagation from source and sink, `finished()` resolve
    on `end` and reject on `error`.
  - `backpressure.test.ts` — `Writable.write()` returns `false` past HWM and
    emits `'drain'` once; no `'drain'` for sub-HWM writes; `Readable`
    `pause`/`resume` and `push(null)` termination.
  - `transform.test.ts` — subclass with `transform` passed to `super()`
    correctly maps chunks; pinned test guards against future regressions in
    Transform's instance-field `write`/`end` rebinding (Finding #2 from the
    streams review); `Duplex.write` routes to the writable side without
    echoing to the readable side.

### Fixed

- The private `EventEmitter#listeners` instance-field name was shadowing the
  prototype `listeners()` accessor, making the Node-compatible
  `ee.listeners(name)` call un-invokable. Renamed the field to `listenersMap`
  and exposed `listeners()` as a normal method.
