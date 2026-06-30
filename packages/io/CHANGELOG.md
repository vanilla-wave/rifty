# Changelog

## [Unreleased]

### Added

- **`Writable` `cork()` / `uncork()` + real `_writev` batching.** `cork()` defers
  buffered writes (no `_write`/`_writev` while corked); `uncork()` flushes them —
  in ONE `_writev(chunks, cb)` call (Node's `[{chunk, encoding}, …]` shape) when
  2+ chunks are pending and a `_writev` exists, else sequential `_write` (order
  preserved). Nested cork is a counter (`writableCorked`); the buffer drains only
  when it returns to 0, and `end()` clears it (implicit uncork). A corked stream
  still reports backpressure (`write()` → `false` past HWM) and emits `'drain'`
  after the flush. The `writev?` option (and a subclass `_writev` override) is
  **re-added WIRED FOR REAL** — the previously-removed type-only placeholder lied
  (it did nothing); it is accepted now ONLY because it is honored. A `_writev`
  error errors every batched callback and destroys the stream. All parity-proven
  vs real Node.

- **Stream predicates + default-HWM accessors + `addAbortSignal`.**
  `isReadable`/`isWritable`/`isErrored`/`isDisturbed` (Node v16.14/v17.3) read the
  existing `_readableState`/`_writableState`; `isDisturbed` is backed by an
  EXPLICIT `disturbed` bit (set on first chunk-consumed or destroy), never
  inferred. Return shapes match REAL Node exactly: `isReadable`/`isWritable` →
  `null` for a non-stream (or wrong half), `isErrored`/`isDisturbed` → `false`;
  a non-stream input never throws. `getDefaultHighWaterMark(objectMode)` /
  `setDefaultHighWaterMark(objectMode, n)` (Node v19.9) — the default HWM is now a
  single module-level source of truth (65536 bytes / 16 objects, matching current
  Node; the ctors' hardcoded `?? 16*1024` is gone) read by the Readable/Writable
  constructors when no explicit `highWaterMark` is passed (an explicit option
  still wins). `addAbortSignal(signal, stream)` (Node v15.4) is now a standalone
  export, extracted from `Readable.fromWeb`'s inline abort wiring (which reuses
  it): aborting destroys the stream with an `AbortError` (`code:'ABORT_ERR'`),
  and an already-aborted signal destroys immediately. All parity-proven vs real
  Node.

- **`Readable.toWeb(r)`** (Node v17) — converts a Node `Readable` into a real
  WHATWG `ReadableStream`. Pull-driven (NOT buffer-the-whole-stream): the
  underlying source pulls exactly one chunk per WHATWG `pull()`, so a slow web
  consumer holds the source paused at its `highWaterMark`. `r` ending → stream
  close; `r` erroring → stream error with the SAME error; `reader.cancel(reason)`
  → `r.destroy()`. Mirrors the existing `Readable.fromWeb`. Parity-proven vs real
  Node (order/close, error propagation, cancel→destroy, backpressure, object
  mode); exported from `streams/index.ts`.

### Fixed

- **`Duplex`/`Transform` honor instance `_write()` / `_final()` overrides.**
  Real package code such as `fast-glob` mutates a `PassThrough` instance's
  `_write` method after construction. The writable side now checks the owning
  stream instance before falling back to constructor options/default no-op,
  unblocking Prettier's file traversal path without a fake stream shortcut.
- **`Buffer` variable-width int accessors + `copyBytesFrom` + `INSPECT_MAX_BYTES` now validate like Node** (PR #62 review hardening; parity RED-then-GREEN vs Node 24). `write{U}IntLE/BE` throw `ERR_OUT_OF_RANGE` for an out-of-range/negative `value` (was a SILENT `& 0xff` wrap — a wrong-answer stub); `read{U}IntLE/BE` + the writers throw `ERR_OUT_OF_RANGE` for an out-of-bounds / non-integer `offset` or `byteLength ∉ [1,6]` (was a bare DataView `RangeError` with no `.code`). `Buffer.copyBytesFrom(view, offset, length)` validates `offset`/`length` — `ERR_INVALID_ARG_TYPE` (non-number) / `ERR_OUT_OF_RANGE` (non-integer or negative) — instead of silently coercing a string/float/NaN/negative through the `Uint8Array` ctor. `buffer.INSPECT_MAX_BYTES = N` rejects a non-number (`ERR_INVALID_ARG_TYPE`) / negative (`ERR_OUT_OF_RANGE`). The pre-existing FIXED-width accessors (`readUInt8`/`writeUInt8`/…) share the same gap — tracked in `backlog/runtime-js/buffer-fixed-width-int-validation`.
- **`Buffer.isBuffer` / `instanceof Buffer` are now bundling-robust (prod-only express crash).**
  The production multi-worker bundle can DUPLICATE the `Buffer` class across chunks
  (the global `Buffer` install vs the `node:buffer` builtin `require('buffer')`
  resolves to — verified `globalThis.Buffer !== require('buffer').Buffer` in a prod
  worker). `isBuffer` was `v instanceof Buffer`, class-identity-fragile across copies:
  express's `res.json` does `Buffer.from(body)` (one copy) and hands it to `etag`, whose
  `Buffer.isBuffer` (the other copy) returned `false` → `TypeError: argument entity must
  be string, Buffer, or fs.Stats` → **500 on every `res.json`** (express-sqlite preset,
  prod deploy only; the `pnpm dev` e2e never saw it). Now a shared
  `Symbol.for('@riftydev/io.Buffer')` brand (set on the prototype) backs both
  `Buffer.isBuffer` and a `[Symbol.hasInstance]` override (additionally requiring a
  `Uint8Array` instance so a bare branded plain object is not mis-recognized), so any
  rifty Buffer is recognized regardless of which class copy created it — the same brand
  technique the `buffer` npm package uses via `_isBuffer`.

### Removed

- **Dead type-only `writev?` option on `WritableOptions`** (backlog/runtime-js/silent-node-divergences). It was declared but used NOWHERE — `drainBuffer` always calls `_write` per chunk — so the type silently lied that batching was wired (no-silent-stub rule). Behaviour-preserving (no consumer passed it). Real cork/uncork/`_writev` batching is owned by `whatwg-stream-bridge-and-statics`, which re-adds the option when it lands.

### Added

- **`getInspectMaxBytes` / `setInspectMaxBytes`** — a live cell backing Node's mutable `buffer.INSPECT_MAX_BYTES` (default 50), read by the runtime-js inspector's `<Buffer …>` hex renderer so `buffer.INSPECT_MAX_BYTES = N` actually changes truncation. (backlog/runtime-js/web-globals-and-buffer-exports)
- **Variable-width `Buffer` integer accessors** `read{U}IntLE/BE(offset, byteLength)` + `write{U}IntLE/BE(value, offset, byteLength)` (1–6 byte, ≤48-bit; signed forms sign-extend; writers return `offset+byteLength`), **`buf.toJSON()`** (`{ type: 'Buffer', data: [...] }`), **`Buffer.copyBytesFrom(view[, offset[, length]])`** (explicit element-window copy of a TypedArray), and **`isUtf8` / `isAscii`** byte predicates (`node:buffer`). `copyBytesFrom`/`isUtf8`/`isAscii` reject a DataView with `ERR_INVALID_ARG_TYPE` like Node (a DataView is an ArrayBufferView but not a TypedArray). Parity-pinned vs Node v24. (backlog/runtime-js/web-globals-and-buffer-exports)

- **`Readable.fromWeb()` plus Promise-aware `pipe()` backpressure (ADR-0154).**
  WHATWG `ReadableStream` bodies can now become Node-shape `Readable`s while
  preserving chunk boundaries, and `Readable.pipe()` pauses when a sink's
  `write()` returns a Promise. This makes `Readable.fromWeb(body).pipe(res)`
  work with `@riftydev/net` `ServerResponse` without an adapter.

### Performance

Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (+ `js-runtime-perf-adr-plan-2026-06-06.md`). All behavior-preserving except where noted; parity + unit suites green.

- **Hoisted module-level UTF8 codec singletons** in `buffer-codec.ts` (`UTF8_ENCODER`/`UTF8_DECODER`) — `encode`/`decode` no longer `new TextEncoder()/TextDecoder()` per call. One-shot utf8 codec is stateless, so a shared instance is byte-identical. The per-stream streaming decoder (`readable.ts`, `{stream:true}`, cross-chunk state) is left per-instance.
- **Batched `decode()` code-unit assembly.** The latin1/binary/ascii/utf16/base64 branches build chunked `number[]` and `String.fromCharCode.apply` over 8192-unit slices instead of per-char `s += String.fromCharCode(...)` (O(n²) concat → O(n)). utf16 trailing-odd-byte truncation (`units = length>>>1`) and the ascii 7-bit mask preserved; hex untouched (uses `toString(16)`).
- **`bytesToString` exported (ADR-0082).** `decode` is now public as `bytesToString` so text reads can decode zero-copy instead of via a throwaway Buffer copy. See ADR-0082; consumed by `runtime-js` fs.
- **Cached per-receiver full-range `DataView` for Buffer int/float accessors** (`buffer-prototype.ts`). `read/write{U,}Int*`/`Float*`/`Double*`/`Big*` reuse one lazily-built `DataView` (WeakMap-keyed per Buffer) instead of `new DataView(buffer, byteOffset+offset, N)` per call. OOB still throws `RangeError` (cached `dv.getX(offset)` past bounds throws — no byte-math garbage path). subarray/clone get a fresh view on cache miss; the `dv.buffer !== u8.buffer` guard rebuilds on backing-buffer change. Parity: `buffer/oob-accessors.case.ts`, `buffer/clone-dataview-survival.case.ts`.
- **`EventEmitter.emit()` single-listener fast path.** Exactly one listener: read it into a local and call it directly, skipping the `arr.slice()` snapshot alloc. `len>1` keeps the slice snapshot (once/removeListener-during-emit semantics). Both branches return `true`. Parity: `events/emit-single-listener-self-remove.case.ts`.
- **Stream single-schedule drain/flow.** `Writable` drains buffered chunks in a bounded sync loop (collapsing the one-chunk-per-microtask chain) and coalesces drain scheduling behind a `drainScheduled` flag; `Readable` coalesces a burst of `push()`/resume/flow re-arms behind a `flowScheduled` flag (its `flow()` already drained synchronously). Event order/values identical — only microtask-turn count drops. Full stream unit + `stream/*`/`http/*` parity + stream/http conformance green.

### Fixed

- **`Writable` destroys and errors every buffered callback on a `_write` error.**
  A failing `_write` callback errored only the in-flight chunk and stopped,
  leaving still-queued writes' callbacks uncalled and `destroyed === false`. It
  now destroys the stream (Node semantics): the failing callback gets the error,
  every buffered callback is errored, and `'error'`+`'close'` fire. Parity:
  `stream/writable-write-error.case.ts`.
- **`Readable.pipe()` destroys the source when a promise sink rejects.** On a
  rejected `write()` promise the source was left paused-and-undestroyed (producer
  leak); it now tears the source down after surfacing the error to the dest.
- **`Writable` now calls subclass `_write()` / `_final()` methods.** Real stream
  consumers such as npm `ws` implement `class Receiver extends Writable` and
  provide `_write()` on the prototype instead of passing `{ write }` options.
  rifty previously drained the chunk through the default no-op path, so the real
  `ws` package opened but never emitted `'message'` inside the module loader.
  Guard: `writable.sync-drain.test.ts` plus `ws-package-loader.test.ts`.
- **`Buffer.toString('ascii')` masks bytes >= 0x80 to 7-bit (`& 0x7f`).** Node's ascii decode is 7-bit (0x80→U+0000, 0xFF→U+007F); rifty previously emitted the raw byte. `latin1`/`binary` stay unmasked (full 0-255); ascii ENCODE is unchanged (Node does not 7-bit-mask on encode). Also corrects `setEncoding('ascii')` streaming decode (routes through `Buffer.toString('ascii')`). Parity: `buffer/tostring-ascii-mask.case.ts`.

### Added

- **`Readable.setEncoding(encoding)` + `readableEncoding`** (ADR-0069). After
  `setEncoding`, `'data'` events and `read()` return decoded **strings** (was raw
  bytes); the TextDecoder set (utf8/utf16le/latin1) decodes streaming-safe across
  chunk boundaries, the rest (ascii/hex/base64) per-chunk via `Buffer`. No-op for
  any consumer that never calls it (existing behaviour byte-identical). Required
  by `@effect/platform-node`'s body reader (`NodeStream.toString`), which calls
  `stream.setEncoding('utf8')` — so every opencode POST-with-body route depends on
  it. Parity: `stream/readable-set-encoding.case.ts`.

### Fixed

- **`EventEmitter` lazily initialises its state (Node mixin/`util.inherits`
  compat).** Instance state (`listenersMap`, `maxListeners`, `warned`) moved
  from eager class fields to lazy getters, so the methods work when the
  constructor never ran — the Node idioms `EventEmitter.call(this)` (via
  `util.inherits`) and copying `EventEmitter.prototype` onto a plain function
  (express's `app`, via `merge-descriptors`). Previously both threw
  `Cannot read properties of undefined (reading 'get')`. Found running real
  express@4.

### Added

- **Legacy callable `Stream` base (`@riftydev/io` → `Stream`).** Node's
  `require('stream')` IS the `Stream` constructor (a function inheriting
  EventEmitter) with the modern classes attached as statics
  (`Stream.Readable`, …, `Stream.Stream === Stream`). We collapse Node's
  `Readable → Stream → EventEmitter` chain, so this base exists purely so
  `util.inherits(SubStream, require('stream'))` + `Stream.call(this)` works
  (e.g. `send`'s `SendStream`). The `node:stream` adapter's `default` export is
  now this callable base. Conformance: `tests/conformance/builtins/stream-legacy.test.ts`.
- **`Buffer.allocUnsafeSlow` and `Buffer.isEncoding`.** `safe-buffer` only
  re-exports the real `buffer` module (the one carrying `Buffer.isBuffer`) when
  `from && alloc && allocUnsafe && allocUnsafeSlow` are ALL present; the missing
  `allocUnsafeSlow` made it fall back to a shim without `isBuffer`, so express's
  `res.send` threw `Buffer.isBuffer is not a function`. Conformance:
  `tests/conformance/builtins/buffer-statics.test.ts`.

### Changed

- `pipeline()` validates each argument is a stream-shaped object (an
  `EventEmitter` with `on(...)`) BEFORE wiring `pipe()` calls. Passing a
  plain object now throws `TypeError` synchronously with the offending
  argument's index (`"pipeline: argument must be a stream (index N
  received a non-stream value)"`), where previously the call would reach
  the pipe loop and crash later with a cryptic `dest.write is not a
  function`. Real stream subclasses are unaffected.
- `Duplex`'s internal writable-side factory hook is now keyed by a
  module-private `Symbol` (`INTERNAL_WRITABLE_SIDE`) instead of the
  `_internalWritableSide` field on the public constructor options bag.
  The public option type is plain `ReadableOptions & WritableOptions` —
  the hook does not appear on it. Only `Transform` (inside `@riftydev/io`)
  imports the symbol directly; subclasses written outside the package
  cannot reach it, so the type wall between "public option bag" and
  "internal subclass hook" is real and not just a naming convention.
- `Buffer.compare(a, b)` static now accepts the same four optional range
  parameters as the instance method
  (`targetStart?`, `targetEnd?`, `sourceStart?`, `sourceEnd?`). When
  omitted the behaviour matches Node's two-arg form; when supplied,
  comparison is delegated to `compareSlices(a.subarray(...),
  b.subarray(...))`. Note: Node 24's runtime `Buffer.compare` has
  `length === 2` and silently ignores any extras (verified via the
  parity runner). Our widened signature is forward-compatible — callers
  can pass ranges symmetrically and we honour them; no parity-runner
  case is added because Node would diverge here.
- `BuiltinFactory` is now parameterised over its return type
  (`BuiltinFactory<T = unknown> = () => T`) and `registerBuiltin<T>(name,
  factory)` is generic. Registration sites now preserve each builtin's
  concrete module shape, so a typo against an exported namespace becomes a
  typecheck error rather than a runtime surprise. Internal storage remains
  at `BuiltinFactory<unknown>` — one well-scoped cast inside the registry
  — and the `loadBuiltin(name)` lookup contract is unchanged
  (`Record<string, unknown> | null`).

### Added

- **ADR-0036: preview-protocol addressing module.** New module
  `src/preview-protocol.ts` owns the `/preview/<port>/...` URL convention
  and the synthetic `preview.local` host shared between
  `@riftydev/service-worker` (SW-side intercept) and `@riftydev/net` (port
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
  moved verbatim from `@riftydev/runtime-js/src/builtins/registry.ts` — same
  cache semantics, same `node:` prefix stripping, same re-register clears
  cache behaviour. The move closes the `@riftydev/net → @riftydev/runtime-js`
  reverse import that survived ADR-0012; both packages now reach the
  registry through `@riftydev/io` (forward-only). See ADR-0035 for the
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

- **ADR-0034 (D-B, IRREVERSIBLE):** `@riftydev/io` stream primitives restored
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
  - `runtime-js`, `kernel`, and `net` now import these from `@riftydev/io`; their previous in-package copies became re-export shims.
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
