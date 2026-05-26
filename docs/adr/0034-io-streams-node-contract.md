# ADR 0034: `@rifty/io` streams — Node-contract restoration

Status: Accepted
Date: 2026-05-26

## Context

The 2026-05-26 architecture review (`docs/review/2026-05-26-architecture-review.md`)
identified five places where `@rifty/io`'s stream primitives diverged from
Node's documented contract. Quoting the review (Tier 1 #5, "io-streams ниже
Node-контракта") and the per-module **io** appendix:

> `Duplex/Transform.write` per-instance ребиндится в конструкторе;
> `Readable.read(n)` игнорирует `n`; `pipeline` не destroy'ит upstream при
> ошибке. Любая третья библиотека на transform pipelines (`tar-stream` /
> `gunzip-maybe` в `@rifty/npm-client`, внутренности Vite) — undefined
> behaviour. Один корень для нескольких следствий выше по стеку.

And from the "Сквозные темы #2 — Streams — слабое место всей пирамиды":

> io-streams ниже Node-контракта. Это каскадно сдерживает четыре модуля:
> `shell` буферизует stdout строкой, `terminal` не имеет backpressure-контракта,
> `net` outgoing `http.request` буферизует body в `Blob(bodyChunks[])`,
> `runtime-wasi` `fd_read` на stdin молча возвращает EOF.
> **Это один корень.** Чинить io-streams — самый большой single-PR win.

Specifically:

1. **`EventEmitter` does not emit the `'removeListener'` meta-event.**
   Node's `Stream.Readable.pipe()`/`unpipe()` machinery relies on this meta-event
   for cleanup ladders. Without it, downstream cleanup code that hooks into
   `'removeListener'` silently no-ops. (`packages/io/src/event-emitter.ts:70-86`.)

2. **`Readable.read(n)` ignores `n`.** The implementation pre-ADR shifts the
   first buffered entry regardless of the requested size. Binary-mode consumers
   that drive frame-aligned reads (`tar-stream` — 512-byte tar headers; HTTP
   chunked encoders; WASI `fd_read`) get back arbitrary chunk lengths instead.
   (`packages/io/src/streams/readable.ts:69-77` pre-ADR.)

3. **`Writable.destroy()` is a no-op for queued writes.** It emitted
   `'error'` + `'close'` but did not flip `state.destroyed`, did not error the
   buffered-write callbacks, and silently accepted further `write()` calls.
   `pipeline()`'s cleanup, HTTP `IncomingMessage` aborts, and any caller that
   destroys a stream mid-flight all suffer. (`packages/io/src/streams/writable.ts:135-139`
   pre-ADR.)

4. **`Duplex`/`Transform` rebind `write`/`end` as per-instance fields.** The
   constructors pre-ADR did `this.write = ...` and `this.end = ...` inside the
   class body. `Object.getPrototypeOf(duplex).write` returned `undefined`;
   `super.write(...)` from a sub-subclass was unreachable; an existing test
   (`packages/io/src/streams/transform.test.ts:29-55` pre-ADR) explicitly
   documented this as a "late binding hazard guard".
   (`packages/io/src/streams/duplex.ts:11-30`, `transform.ts:33-65` pre-ADR.)

5. **`pipeline()` does not destroy upstream on error.** When a downstream
   stage errors, the readable continues to push data into a dead writable.
   Node's contract is that `pipeline` calls `destroy(err)` on every other
   stage in the chain. (`packages/io/src/streams/pipeline.ts:24-29` pre-ADR.)

The architecture review's "Архитектурные решения" section recorded this as
**D-B [I]** with **option A: full restoration as one PR in M10** chosen
explicitly. This is IRREVERSIBLE because it touches the public API of
`@rifty/io` (the `Readable`/`Writable`/`Duplex`/`Transform`/`pipeline` shapes
and the `EventEmitter.removeListener` semantics). Must land before M11 A-008
(esbuild.wasm push) — esbuild's WASI stdio assumes Node-shape streams.

## Decision

Bring `@rifty/io` stream primitives back to the Node-documented contract in
one PR. The five behaviour changes are:

### 1. `EventEmitter.removeListener` emits `'removeListener'` meta-event

After detaching a listener (i.e. `arr.splice(idx, 1)` succeeded),
`removeListener(event, listener)` emits a synchronous `'removeListener'`
event with `(event, removedListener)`. The emit is suppressed when the event
being removed IS `'removeListener'` itself — otherwise
`removeListener('removeListener', metaHandler)` would recurse infinitely.

### 2. `Readable._readableState` + honest `read(n)` + flowing-mode pump

The `Readable` instance now carries a `_readableState` field-bag mirroring
Node's `internal/streams/state.js`. Fields surfaced: `buffer`, `length`,
`highWaterMark`, `objectMode`, `flowing`, `ended`, `endEmitted`, `reading`,
`destroyed`, `errored`. Only the fields that rifty's own code or the wider
Node ecosystem inspect are added — placeholder fields for "shape parity" are
NOT added (would violate "no silent stubs").

`read(n)` now honors the requested size:
- `n === 0` → peek, schedule `_read`, return `null`.
- `n` bytes available in byte mode → slice exactly `n` bytes, splitting
  across queued chunks if needed (via a new `sliceBuffer` helper that
  coalesces Buffer entries).
- `n` bytes NOT available → schedule `_read(min(hwm, n))`; if the synchronous
  `_read` pushes enough during the call, return the slice in the same tick.
- `n === undefined` → return everything currently buffered as one chunk
  (Buffer.concat in byte mode, single entry in object mode).
- `state.ended && state.length === 0` → emit a final `'readable'` (if any
  listener) then `'end'`; return `null`.

`flow()` pumps `_read` between flushes — after every drain to HWM headroom,
schedules another `_read` so flowing-mode keeps demand on the source.

`push(chunk)` after EOF emits an `'error'` (matching Node's "stream.push()
after EOF" check). `push(null)` while paused schedules a final `'readable'`
emit before `'end'`.

Public read-only accessors mirror Node: `readable`, `readableHighWaterMark`,
`readableObjectMode`, `readableLength`, `readableEnded`, `destroyed`. The
old per-instance fields (`readableHighWaterMark = 16384`, etc.) are now
getters delegating to `_readableState`.

### 3. `Writable._writableState` + `destroy()` cancels in-flight queue

The `Writable` instance now carries a `_writableState` field-bag mirroring
Node's `internal/streams/state.js`. Fields surfaced: `buffered`, `length`,
`highWaterMark`, `objectMode`, `writing`, `ending`, `finished`, `destroyed`,
`errored`, `needDrain`.

`destroy(err?)`:
- Idempotent — second call is a no-op.
- Flips `state.destroyed = true` synchronously.
- Stores `state.errored = err`.
- Snapshots and drains the buffered-write queue, scheduling each callback's
  `cb(err)` invocation on the next microtask.
- Schedules `emit('error', err)` (if err) then `emit('close')` on the next
  microtask.
- Subsequent `write(chunk, cb)` calls invoke `cb(state.errored)` on the
  next microtask AND return `false` synchronously.

The `drainBuffer` callback now checks `state.destroyed` before its success
path so a `_write` that runs concurrent with `destroy()` does not emit
`'drain'`/`'finish'` against a destroyed stream.

Public read-only accessors: `writable`, `writableHighWaterMark`,
`writableObjectMode`, `writableLength`, `writableEnded`, `writableFinished`,
`destroyed`.

### 4. `Duplex`/`Transform` — methods on the prototype, no per-instance rebinding

`Duplex.prototype.write`, `Duplex.prototype.end`, `Duplex.prototype.destroy`
now live on the prototype as methods, not assigned as instance fields in the
constructor. `Transform`'s constructor uses a new protected hook
`DuplexInternalOptions._internalWritableSide` (a factory) to inject its own
`Writable` side wired to `_transform`/`_flush` semantics. The factory uses a
ref-cell back-filled after `super(...)` returns so the writable-side
callbacks can reach the `Transform` instance for `push()`.

`writableSide` is now `readonly` (was a mutable instance field). The
`writableSide` instance is constructed via the factory hook and propagates
`'finish'`, `'error'`, `'drain'` up to the Duplex via standard EE
listeners.

`Duplex.prototype.destroy` destroys both halves (writable side first so its
queued callbacks error before the readable side closes).

`Duplex` exposes `_writableState` as a getter delegating to
`writableSide._writableState`. Downstream code that does
`d._writableState.destroyed` works through this hop.

### 5. `pipeline()` destroys upstream on error

Per-stage error absorbers are installed on every chain stage at pipeline
start. On the FIRST error from ANY stage, `pipeline()`:
- Sets `settled = true`.
- Calls `destroy(err)` on every OTHER stage (except the source of the error).
- Invokes the user callback with the error.
- Rejects the returned promise.
- Schedules absorber detach on the NEXT microtask pass (deep enough that
  the deferred `'error'` emits from `destroy()` are absorbed first).

The returned promise's `.catch(() => {})` is added when a callback is
supplied so unhandled-rejection noise doesn't escape (the callback IS the
user's error-handling path). When no callback, the promise must be awaited
or `.catch()`'d by the caller — same as Node's `stream.promises.pipeline`.

## Consequences

### Tests updated under this ADR's authorization

CLAUDE.md hard rule: "Never modify a test to make code pass." This ADR is
the canonical exception — the tests below ENCODED the broken contract
called out in the review, so updating them is "the contract changed at this
ADR's boundary", not "the test was wrong, relax it". Each modified test
file carries an `// Updated per ADR-0034:` comment header in the source.

| File | Lines | Change |
|---|---|---|
| `packages/io/src/streams/transform.test.ts` | 1-6 | Added ADR header comment block clarifying the post-ADR shape (methods on prototype, `writableSide` readonly, `_writableState` getter). |
| `packages/io/src/streams/transform.test.ts` | 59-79 | Removed `d.writableSide = Object.assign(d.writableSide, {})` (writableSide is now `readonly`); reworded the test to assert the protocol-level invariant (writes don't echo to readable side) without reaching into private impl. |
| `packages/io/src/streams/transform.test.ts` | 32-56 | Reworded the "late binding hazard guard" comment to reflect that prototype-based methods now make this safe; the test still pins the canonical `super({...transform: ...})` path that pre- and post-ADR upholding. |

### Downstream caller migrations

No downstream caller depended on a broken-contract shape — searched
`packages/{net,runtime-js,kernel,shell,npm-client,runtime-wasi}/src/` and
`apps/playground/src/` for:
- `writableSide` direct write access — only one hit in `vfs/opfs.ts:98` and
  that's an OPFS `FileSystemWritableFileStream`, unrelated.
- `_readableState` / `_writableState` consumer access — none.
- `extends Duplex` / `extends Transform` subclass with per-instance method
  rebinding — none.
- `Readable.read(n)` with explicit `n` — none (all `.read()` calls in
  packages/ are on WHATWG `ReadableStream` readers, not our `Readable`).

The only consumer of the broken Duplex/Transform write-rebinding pattern was
the internal `Transform` constructor itself, which is rewritten under change
(4) above. Consumer-side migration is therefore empty — the rewrite is
internal to `@rifty/io`. This is a deliberate side-benefit of the layered
architecture: `Readable`/`Writable`/`Duplex`/`Transform` are intermediate
primitives, and downstream code consumes the higher-level Node-shape
behaviour (via `node:stream` re-exports from `runtime-js/builtins/stream.ts`)
not the broken contract.

### Unblocked work

- **A-008 (esbuild.wasm WASI stdio, M11):** esbuild reads bundled input from
  stdin via WASI `fd_read`. Pre-ADR `Readable` would have returned arbitrary
  chunk sizes against the consumer's frame-aligned reads. Now safe.
- **M12 streaming HTTP (A-022/A-024/A-025):** the streaming HTTP rewrite in
  ADR-0017 phase 2 depends on `Writable.destroy` actually destroying so that
  a request abort propagates upstream. Now in place.
- **Tier 0 shell streaming output:** the shell rehab (D-C, completed earlier
  in this milestone) now sits on top of streams that honour backpressure
  end-to-end rather than buffering arbitrarily.

### Negative consequences

- **Surface area increased.** `_readableState` and `_writableState` are now
  public-by-convention (Node ecosystem reads them). We can't refactor them
  freely without a new ADR.
- **`writableSide` is now `readonly`.** Test code that previously assigned to
  it is broken at compile time; only the one test in `transform.test.ts`
  exercised this and was updated per the migration table above.
- **Transform constructor allocates one extra ref-cell.** Trivial — one
  object literal per Transform instance — but flagged for transparency.

## Alternatives considered

### Option B: phased restoration across multiple PRs (review's recommended option)

The review listed three phases: EE meta-event + Writable.destroy first (M10
mid), then `read(n)` + flowing pump (M10 late), then Duplex/Transform
prototype methods (M11 prep). The user explicitly chose Option A over this
on 2026-05-26 with the argument "avoid mid-flight broken state across
multiple PRs". One PR keeps the contract coherent during the M10 Real Vite
demo cycle and avoids a 3-PR review burden. **Rejected.**

### Option C: defer to M11 entirely

Rationale: M10 demos are reproducible without full Node-contract
compliance, so push the rewrite to M11 where esbuild needs it anyway.
Rejected because the architecture review explicitly identified streams as
"один корень" cascading into shell, terminal, net, and WASI — fixing later
means stacking new code on a broken primitive. **Rejected.**

## Acceptance criteria

- [x] `EventEmitter.removeListener` emits the meta-event; parity case
      `tools/node-parity-runner/cases/events/remove-listener-meta.case.ts`
      matches Node.
- [x] `Readable._readableState` container present; `read(n)` honours `n`;
      parity case `tools/node-parity-runner/cases/stream/readable-read-n.case.ts`
      matches Node (binary-mode 2-byte frame-aligned reads + final tail).
- [x] `Writable.destroy` cancels queued writes and rejects subsequent writes
      with the destroy error; parity case
      `tools/node-parity-runner/cases/stream/writable-destroy.case.ts`
      matches Node.
- [x] `Duplex`/`Transform` write/end on prototype; `writableSide` readonly;
      parity case
      `tools/node-parity-runner/cases/stream/duplex-prototype-methods.case.ts`
      matches Node (`hasOwnProperty(d, 'write') === false`).
- [x] `pipeline()` destroys upstream on error; parity case
      `tools/node-parity-runner/cases/stream/pipeline-destroy-upstream.case.ts`
      matches Node.
- [x] Existing unit tests (`packages/io/src/{event-emitter,streams/*}.test.ts`)
      and conformance suite (`tests/conformance/builtins/stream.test.ts`) all
      pass without weakening assertions.
- [x] `pnpm test:run` clean.
- [x] `pnpm test:parity` clean (5 new cases added, 35 total, all matching).
- [x] `pnpm test:conformance` clean.
- [x] `pnpm test:integration` clean.
- [x] `pnpm typecheck` clean.
- [x] `pnpm lint` clean (no new warnings introduced — pre-existing
      `perf_hooks.ts` warning unchanged).
- [x] `pnpm check:deps` clean.
- [x] `CHANGELOG.md` updated in `packages/io` (multiple lines documenting
      each contract restoration).
