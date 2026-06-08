# ADR 0034: `@riftydev/io` streams — Node-contract restoration

Status: Accepted
Date: 2026-05-26

## Context

The 2026-05-26 architecture review (`docs/review/2026-05-26-architecture-review.md`)
found `@riftydev/io`'s stream primitives diverging from Node's contract in five
places. The review flagged this as one root cause (Tier 1 #5; **io** appendix):
`Duplex/Transform.write` is rebound per-instance in the constructor;
`Readable.read(n)` ignores `n`; `pipeline` doesn't destroy upstream on error.
Any third-party transform-pipeline lib (`tar-stream`/`gunzip-maybe` in
`@riftydev/npm-client`, Vite internals) hits undefined behaviour. The
cross-cutting theme #2 ("streams are the weak point of the whole pyramid") notes
this cascades into four modules — `shell` buffers stdout as a string, `terminal`
has no backpressure contract, `net` outgoing `http.request` buffers body in
`Blob(bodyChunks[])`, `runtime-wasi` `fd_read` on stdin silently returns EOF —
and calls fixing io-streams "the biggest single-PR win."

The five divergences:

1. **`EventEmitter` doesn't emit `'removeListener'` meta-event.** Node's
   `pipe()`/`unpipe()` cleanup ladders rely on it; downstream cleanup hooked to
   `'removeListener'` silently no-ops. (`packages/io/src/event-emitter.ts:70-86`.)
2. **`Readable.read(n)` ignores `n`.** Pre-ADR it shifts the first buffered entry
   regardless of requested size. Frame-aligned binary consumers (`tar-stream`
   512-byte headers; HTTP chunked encoders; WASI `fd_read`) get arbitrary
   lengths. (`packages/io/src/streams/readable.ts:69-77` pre-ADR.)
3. **`Writable.destroy()` is a no-op for queued writes.** Emitted
   `'error'`+`'close'` but didn't flip `state.destroyed`, didn't error buffered
   callbacks, accepted further `write()`. Breaks `pipeline()` cleanup, HTTP
   `IncomingMessage` aborts, mid-flight destroy.
   (`packages/io/src/streams/writable.ts:135-139` pre-ADR.)
4. **`Duplex`/`Transform` rebind `write`/`end` as per-instance fields.** Pre-ADR
   constructors did `this.write = ...`/`this.end = ...` in the class body, so
   `getPrototypeOf(duplex).write === undefined` and `super.write(...)` from a
   sub-subclass was unreachable; a test
   (`packages/io/src/streams/transform.test.ts:29-55` pre-ADR) documented this as
   a "late binding hazard guard".
   (`packages/io/src/streams/duplex.ts:11-30`, `transform.ts:33-65` pre-ADR.)
5. **`pipeline()` doesn't destroy upstream on error.** A downstream error leaves
   the readable pushing into a dead writable; Node calls `destroy(err)` on every
   other stage. (`packages/io/src/streams/pipeline.ts:24-29` pre-ADR.)

The review recorded this as **D-B [I]**, option A (full restoration as one PR in
M10) chosen explicitly. IRREVERSIBLE: touches the public API of `@riftydev/io`
(`Readable`/`Writable`/`Duplex`/`Transform`/`pipeline` shapes,
`EventEmitter.removeListener` semantics). Must land before M11 A-008
(esbuild.wasm push) — esbuild's WASI stdio assumes Node-shape streams.

## Decision

Restore the Node contract in one PR. Five changes:

### 1. `EventEmitter.removeListener` emits `'removeListener'` meta-event

After a listener detaches (`arr.splice` succeeded), emit synchronous
`'removeListener'` with `(event, removedListener)`. Suppressed when the removed
event IS `'removeListener'` (else infinite recursion).

### 2. `Readable._readableState` + honest `read(n)` + flowing-mode pump

`Readable` carries `_readableState` mirroring Node's
`internal/streams/state.js`. Fields: `buffer`, `length`, `highWaterMark`,
`objectMode`, `flowing`, `ended`, `endEmitted`, `reading`, `destroyed`,
`errored`. Only fields rifty or the Node ecosystem inspect — no placeholder
"shape parity" fields (would violate "no silent stubs").

`read(n)` honors size:
- `n === 0` → peek, schedule `_read`, return `null`.
- `n` available (byte mode) → slice exactly `n` bytes, splitting across queued
  chunks via a new `sliceBuffer` helper that coalesces Buffer entries.
- `n` not available → schedule `_read(min(hwm, n))`; if a synchronous `_read`
  pushes enough, return the slice same-tick.
- `n === undefined` → return all buffered as one chunk (`Buffer.concat` in byte
  mode, single entry in object mode).
- `state.ended && length === 0` → final `'readable'` (if listener) then `'end'`,
  return `null`.

`flow()` schedules another `_read` after each drain to HWM headroom, keeping
demand on the source. `push(chunk)` after EOF emits `'error'` (Node's
"push after EOF"); `push(null)` while paused schedules a final `'readable'`
before `'end'`.

Read-only accessors mirror Node: `readable`, `readableHighWaterMark`,
`readableObjectMode`, `readableLength`, `readableEnded`, `destroyed`. Old
per-instance fields (`readableHighWaterMark = 16384` etc.) are now getters
delegating to `_readableState`.

### 3. `Writable._writableState` + `destroy()` cancels in-flight queue

`Writable` carries `_writableState` mirroring `internal/streams/state.js`.
Fields: `buffered`, `length`, `highWaterMark`, `objectMode`, `writing`,
`ending`, `finished`, `destroyed`, `errored`, `needDrain`.

`destroy(err?)`:
- Idempotent (second call no-op).
- Flips `state.destroyed = true` synchronously; stores `state.errored = err`.
- Snapshots and drains the buffered queue, scheduling each `cb(err)` on the next
  microtask.
- Schedules `emit('error', err)` (if err) then `emit('close')` next microtask.
- Subsequent `write(chunk, cb)` invokes `cb(state.errored)` next microtask AND
  returns `false` synchronously.

`drainBuffer` now checks `state.destroyed` before its success path, so a `_write`
concurrent with `destroy()` doesn't emit `'drain'`/`'finish'` on a destroyed
stream.

Read-only accessors: `writable`, `writableHighWaterMark`, `writableObjectMode`,
`writableLength`, `writableEnded`, `writableFinished`, `destroyed`.

### 4. `Duplex`/`Transform` — methods on the prototype, no per-instance rebinding

`Duplex.prototype.write`/`.end`/`.destroy` now live on the prototype, not as
constructor-assigned instance fields. `Transform`'s constructor uses a new
protected hook `DuplexInternalOptions._internalWritableSide` (a factory) to
inject its own `Writable` side wired to `_transform`/`_flush`; the factory uses a
ref-cell back-filled after `super(...)` so writable-side callbacks can reach the
`Transform` for `push()`.

`writableSide` is now `readonly` (was mutable). It's constructed via the factory
hook and propagates `'finish'`/`'error'`/`'drain'` up to the Duplex via standard
EE listeners. `Duplex.prototype.destroy` destroys both halves (writable first so
its queued callbacks error before the readable closes). `Duplex` exposes
`_writableState` as a getter delegating to `writableSide._writableState`, so
`d._writableState.destroyed` works through the hop.

### 5. `pipeline()` destroys upstream on error

Per-stage error absorbers installed on every stage at start. On the FIRST error
from ANY stage, `pipeline()`:
- Sets `settled = true`.
- Calls `destroy(err)` on every OTHER stage (not the error source).
- Invokes the user callback with the error; rejects the returned promise.
- Schedules absorber detach on the NEXT microtask pass (deep enough that
  `destroy()`'s deferred `'error'` emits are absorbed first).

The returned promise gets `.catch(() => {})` when a callback is supplied (the
callback IS the error path). Without a callback, the caller must await/`.catch()`
it — same as Node's `stream.promises.pipeline`.

## Consequences

### Tests updated under this ADR's authorization

CLAUDE.md hard rule: "Never modify a test to make code pass." This ADR is the
canonical exception — the tests below ENCODED the broken contract from the
review, so updating them is "the contract changed at this ADR's boundary," not
"the test was wrong." Each modified file carries an `// Updated per ADR-0034:`
header.

| File | Lines | Change |
|---|---|---|
| `packages/io/src/streams/transform.test.ts` | 1-6 | ADR header clarifying post-ADR shape (methods on prototype, `writableSide` readonly, `_writableState` getter). |
| `packages/io/src/streams/transform.test.ts` | 59-79 | Removed `d.writableSide = Object.assign(...)` (now `readonly`); reworded to assert the protocol invariant (writes don't echo to readable side) without touching private impl. |
| `packages/io/src/streams/transform.test.ts` | 32-56 | Reworded "late binding hazard guard" comment to reflect prototype methods now make this safe; still pins the canonical `super({...transform: ...})` path. |

### Downstream caller migrations

No downstream caller depended on a broken-contract shape. Searched
`packages/{net,runtime-js,kernel,shell,npm-client,runtime-wasi}/src/` and
`apps/playground/src/`:
- `writableSide` direct write — one hit at `vfs/opfs.ts:98`, but that's an OPFS
  `FileSystemWritableFileStream`, unrelated.
- `_readableState`/`_writableState` consumer access — none.
- `extends Duplex`/`extends Transform` with per-instance method rebinding — none.
- `Readable.read(n)` with explicit `n` — none (all `.read()` in packages/ are on
  WHATWG `ReadableStream` readers, not our `Readable`).

The only consumer of the broken Duplex/Transform write-rebinding was the internal
`Transform` constructor, rewritten under change (4). Consumer-side migration is
empty — the rewrite is internal to `@riftydev/io`. Side-benefit of the layered
architecture: these are intermediate primitives, and downstream consumes the
higher-level Node-shape behaviour (via `node:stream` re-exports from
`runtime-js/builtins/stream.ts`), not the broken contract.

### Unblocked work

- **A-008 (esbuild.wasm WASI stdio, M11):** esbuild reads input from stdin via
  WASI `fd_read`; pre-ADR `Readable` returned arbitrary chunk sizes against
  frame-aligned reads. Now safe.
- **M12 streaming HTTP (A-022/A-024/A-025):** ADR-0017 phase 2's rewrite depends
  on `Writable.destroy` actually destroying so a request abort propagates
  upstream. Now in place.
- **Tier 0 shell streaming output:** the shell rehab (D-C, earlier this
  milestone) now sits on streams that honour backpressure end-to-end.

### Negative consequences

- **Surface area increased.** `_readableState`/`_writableState` are now
  public-by-convention (Node ecosystem reads them); can't refactor freely
  without a new ADR.
- **`writableSide` now `readonly`.** Test code assigning to it breaks at compile
  time; only the one `transform.test.ts` test did, updated above.
- **Transform allocates one extra ref-cell** per instance — trivial, flagged for
  transparency.

## Alternatives considered

### Option B: phased restoration across multiple PRs (review's recommended option)

Three phases: EE meta-event + `Writable.destroy` (M10 mid), `read(n)` + flowing
pump (M10 late), Duplex/Transform prototype methods (M11 prep). User chose Option
A over this on 2026-05-26 — "avoid mid-flight broken state across multiple PRs."
One PR keeps the contract coherent during the M10 Real Vite demo and avoids a
3-PR review burden. **Rejected.**

### Option C: defer to M11 entirely

M10 demos are reproducible without full compliance, so push to M11 where esbuild
needs it anyway. Rejected: the review identified streams as the one root cascading
into shell, terminal, net, WASI — deferring stacks new code on a broken
primitive. **Rejected.**

## Acceptance criteria

- [x] `EventEmitter.removeListener` emits the meta-event; parity case
      `tools/node-parity-runner/cases/events/remove-listener-meta.case.ts`
      matches Node.
- [x] `Readable._readableState` present; `read(n)` honours `n`; parity case
      `tools/node-parity-runner/cases/stream/readable-read-n.case.ts` matches
      Node (binary-mode 2-byte frame-aligned reads + final tail).
- [x] `Writable.destroy` cancels queued writes and rejects subsequent writes with
      the destroy error; parity case
      `tools/node-parity-runner/cases/stream/writable-destroy.case.ts` matches
      Node.
- [x] `Duplex`/`Transform` write/end on prototype; `writableSide` readonly;
      parity case
      `tools/node-parity-runner/cases/stream/duplex-prototype-methods.case.ts`
      matches Node (`hasOwnProperty(d, 'write') === false`).
- [x] `pipeline()` destroys upstream on error; parity case
      `tools/node-parity-runner/cases/stream/pipeline-destroy-upstream.case.ts`
      matches Node.
- [x] Existing unit tests (`packages/io/src/{event-emitter,streams/*}.test.ts`)
      and conformance (`tests/conformance/builtins/stream.test.ts`) pass without
      weakening assertions.
- [x] `pnpm test:run` clean.
- [x] `pnpm test:parity` clean (5 new cases, 35 total, all matching).
- [x] `pnpm test:conformance` clean.
- [x] `pnpm test:integration` clean.
- [x] `pnpm typecheck` clean.
- [x] `pnpm lint` clean (no new warnings; pre-existing `perf_hooks.ts` warning
      unchanged).
- [x] `pnpm check:deps` clean.
- [x] `CHANGELOG.md` updated in `packages/io` (multiple lines per contract
      restoration).
