# ADR 0575: Stream core and fs streams are Node v24.16.0's own sources

Status: Proposed
Date: 2026-11

> TL;DR: `node:stream` is Node v24.16.0's own JS, unedited and generated from the pinned tarball:
> `lib/stream.js`, `lib/stream/promises.js` and `lib/internal/streams/*.js`. `fs.ReadStream` and
> `fs.WriteStream` come unedited from `lib/internal/fs/streams.js` and read and write through fds on
> every host. rifty supplies only the bindings. The hand-written `@riftydev/io` streams and their
> unit tests are retired in one step.
>
> The manager chose this route under the user's delegation (goal `node-streams-as-in-node`); the
> user is informed, confirmation pending.

## Context

Goal `docs/backlog/epics/node-streams-as-in-node/`; probe in its `reference/` (`route-b/`,
`results/route-b-*.txt` and the `rifty-inproc-B` column of each `results/<program>.txt`). Measured
in-process in Node v24.16.0, main `b6d37fc01`'s code.

`packages/io/src/streams` is a hand copy of Node's streams: 4118 lines of source, plus 21 test files
(6402 lines). Three
pieces of work broke on links that copy lacks, because in Node they live in shared state across
`destroy.js`, `end-of-stream.js`, `state.js`, `readable.js`, `writable.js`, `duplex.js`,
`transform.js` and `pipeline.js`:

- the zlib goal (two rounds: `lib/zlib.js` over rifty's `Transform`, 10/16 → 26/45 scenarios differ);
- PR #434 (three review rounds, each finding another missing piece of `Readable`);
- this goal's per-member unit graph (review of PR #450: 3 hidden dependencies).

The project already took the same step twice: ADR-0573 (`lib/zlib.js`) and ADR-0574 (legacy `url`).

Rows equal to Node per route. Route A is rifty's streams today; route B is the verbatim files with
rifty's `events`/`buffer`/`string_decoder`/`fs` and Node's own `internal/*`:

| | A | B |
|---|---|---|
| carrier: whole programs equal | 1/10 | 10/10 |
| m1 lifecycle | 0/14 | 14/14 |
| hook matrix (`stream-destroy-construct-hooks`) | 10/76 | 76/76 |
| m2 state members, m3 legacy chain | 0/7, 0/4 | 7/7, 4/4 |
| m4 `fs.ReadStream`, m5 `fs.WriteStream` | 3/22, 4/14 | 18/22, 13/14 |
| m6 Transform/Duplex, m7 pipeline, m8 options | 0/8, 0/11, 6/16 | 8/8, 11/11, 15/16 |
| zlib goal `zlib-diff` state group: scenarios differing | 26/45 (154 fields) | 6/45 (6 fields) |
| parity `cases/stream` (66 plain CJS) / fs-stream cases (6) | 66, 6 | 59, 3 |

Every difference left on route B traces to a binding, not to the core:

- rifty's `fs.read`/`fs.write` call back in microtasks, so timers do not run during a read. The 3
  fs-stream parity rows that lose a write before `destroy` on route B are a probe artefact: they are
  6/6 on main and with product bindings;
- rifty has no `fs.writev`, so Node sets `_writev = null`;
- `string_decoder` lacks latin1/utf16le and throws `NotImplementedError` where Node throws
  `ERR_UNKNOWN_ENCODING`;
- `Buffer` rejects upper-case encoding names (`'UTF8'`);
- the probe took `FastBuffer` and the web adapters from Node's own internals, so `Buffer.isBuffer`
  and `instanceof` mix two copies. This is a probe artefact; the product-shape run below removes it.

Product shape (`route-b/product/`, `results/route-b-product-*.txt`). What was built:

- The generator takes 23 whole Node files: the core, `fs/streams.js`, `internal/assert`,
  `events/abort_listener` and `webstreams/adapters`.
- It also takes 5 modules cut down to the statements the others read: `internal/{errors,validators,
  util,fs/utils,url}`. The error messages are Node's own `E()` text.
- The bindings contain no Node internals: 79 primordials, each matching Node's in name and `length`
  (`check-primordials.mts`).
- A throwaway product build at `b1270101a` wires these in.

Results:

- Every probe artefact is gone:
  - parity `cases/stream` 59 → 63/66 in-process; the 3 left are binding gaps (latin1, utf16le BOM,
    `'UTF8'`);
  - fs-stream parity 3 → 6/6;
  - `zlib-diff` state group 0 fields once `lib/zlib.js` uses rifty's `Buffer` too.
- Programs on the product build: in-process the same as route B. In the isolate `m7` is 5/11, and the
  pipeline carrier fails with `AbortController2 is not a constructor` — the guest has no
  `AbortController` (Decision 6).

Cost, measured on the product build (`results/route-b-product-build.txt`; min / gzip bytes):

| artifact | main today | product build | budget |
|---|---|---|---|
| `main` | 91 433 / 28 548 | 91 197 / 28 521 | 128 000 / 40 000 |
| `sw` | 16 711 / 5 848 | 16 475 / 5 805 | 23 000 / 8 000 |
| generic | 932 920 / 279 754 | 1 003 635 / 303 440 | 1 124 000 / 332 000 |
| toolchain | 1 061 998 / 323 615 | 1 131 508 / 346 943 | 1 284 000 / 386 000 |
| `guest.js` (esbuild-minified) | 4 404 316 / 1 266 724 | 4 480 138 / 1 291 510 | — |

- `test:client-bundles` passes, including the io ≤ 5120 B guard of `main`/`sw` (950/1021 B). It was
  not run through `check:es-floor`.
- The generated module is lazy CJS functions inside a `/* @__PURE__ */` IIFE; a named top-level
  factory leaked through esbuild's `keepNames`.
- File-level estimate before the build: `results/route-b-size.txt`.
- 10⁵ one-byte writes: Node 5 ms, route A 41 ms, route B 22 ms (`results/route-b-bench.txt`).

## Decision

1. Vendor these Node v24.16.0 files under `tools/publishing/node-streams/`, pinned by sha256 with
   Node's `LICENSE`, and generate them the ADR-0574 way: exact-once anchors only for binding
   inputs, plus a drift check.
   - `lib/stream.js`, `lib/stream/promises.js`;
   - `lib/internal/streams/*.js`, except `fast-utf8-stream.js`, which nothing in the set requires;
   - `lib/internal/fs/streams.js`;
   - `internal/assert`, `internal/events/abort_listener` and `internal/webstreams/adapters` whole;
   - `internal/{errors,validators,util,fs/utils,url}` as the statements the others read (Node's `E()`
     texts).

   That is 28 modules: 23 whole files and 5 cut down.

   Minify keeps identifiers: renaming changes V8's own `TypeError` text (parity `from-web-options`).
   The generator needs `acorn` as a dev dependency.
2. Bindings, and nothing else hand-written. `primordials`, as `url-legacy/bindings.ts` builds them.
   Small ports:
   - `internal/errors`: the 21 codes the files use, `AbortError`, `aggregateTwoErrors`; Node's
     messages;
   - `internal/validators` (9 functions);
   - `internal/util` (`deprecate`, `kEmptyObject`, `once`, `constructSharedArrayBuffer`);
   - `internal/util/types`, `debuglog`, `assert`;
   - `internal/buffer.FastBuffer`, which is rifty's `Buffer`;
   - `internal/event_target` symbols;
   - `internal/events/abort_listener` (`events.addAbortListener`, absent today);
   - `internal/blob.isBlob`;
   - `internal/fs/utils` (`copyObject`, `getOptions`, `getValidatedFd`, `validatePath`);
   - `internal/url.toPathIfFileURL`;
   - `internal/fs/promises`: `FileHandle` is a named gap until rifty has it;
   - and what the generator's closure also reads: `internal/util/inspect`, `internal/encoding`,
     `internal/webstreams/{readablestream,writablestream,queuingstrategies}`,
     `internal/v8/startup_snapshot`, `internal/process/{task_queues,warning}`, and `internalBinding`
     `constants`/`stream_wrap`/`types`/`uv`. The last three throw as named gaps
     (`results/route-b-product-build.txt`).

   Named gap: on a host `EventTarget`, `internal/event_target`'s `kResistStopPropagation` and
   `kWeakHandler` have no effect. Unit 3 measures whether `addAbortListener` observes this.

   Chromium 108 (the tier floor, ADR-0469) lacks APIs this code reaches, so the bindings supply them
   or the core waits on a floor shim. `check:es-floor` and the floor lane prove it:
   - `AbortSignal.any` (`operators.js`; Chromium 116+);
   - `Symbol.dispose`/`Symbol.asyncDispose` (primordials);
   - no `Promise.withResolvers` at load (the probe's `bindings.ts` used it; Chromium 119+).

   rifty modules (`events`, `buffer`, `string_decoder`, `timers`, `async_hooks`, `fs`) are reached
   through the builtin registry's lazy lookup, as `io` streams do today (`readBuiltinUncached`). No
   new layer edge; `check:arch` unchanged.
3. `fs.ReadStream`/`fs.WriteStream` read and write through fds on every host. This replaces
   ADR-0020's «`createReadStream` rebuilds on `Vfs.openReadable`». `Vfs.openReadable` stays a VFS
   API for its other users (shell `_sync-vfs`, workbench glue).
4. Each binding gap the probe found is fixed against Node as its own unit, before the unit that needs it
   (goal `map.md` order):
   - `string_decoder` encodings;
   - `Buffer`'s `normalizeEncoding`;
   - `addAbortListener`;
   - fs callbacks in an I/O turn rather than a microtask;
   - `fs.writev`/`fs.fsync`.
5. Web adapters (`toWeb`/`fromWeb`): Node's `internal/webstreams/adapters` verbatim over the host's
   `ReadableStream`/`WritableStream`. The 14 parity cases using them equal Node. The isolate's
   `ReadableStream` ceiling stays as today.
6. Isolate host: the core's `AbortController`/`AbortSignal` (one per `pipeline` call, `signal`
   passed to function stages and helpers) come from Node's `lib/internal/abort_controller.js` +
   `internal/event_target.js`, verbatim and private to the core. They are not globals, so they
   decide nothing for the isolate Web API goal's question 1. Browser hosts bind the host globals.
   Measured cost and the alternative: goal `map.md` §Open questions.
7. The core is replaced in one step. Hand-written `packages/io/src/streams` and its unit tests go;
   the differential, parity and carrier cases take their place. Internal consumers move to Node's
   API: `net/http/upgrade-socket.ts` writes `_readableState`/`_writableState` fields, and `io`'s
   `onDestroy` hook for `Writable.fromWeb`. There is no state with two cores.

Superseded:

- **ADR-0034** (restoring Node's contract in rifty's streams): its stream parts. §1, the
  `'removeListener'` meta-event of `EventEmitter`, stays: `events` is a binding.
- **ADR-0069** (`setEncoding` through a streaming `TextDecoder`): wholly, D2/D3 included. Node
  decodes at `push` and re-decodes the buffer in `setEncoding`, so `length` counts characters
  (`readable.js:589-605`). rifty decodes at the emit boundary over a raw byte buffer.
- **ADR-0237** (read-hook dispatch and demand latch): wholly, its WHATWG-adapter part through
  Decision 5.
- **ADR-0239** (`fromWeb` staged validation, valid signals a loud gap): wholly; Node's adapters
  validate.
- **ADR-0154** (HTTP stream interop and drain contract): its D3, `pipe` pausing on a `Promise` from
  `write()`. Node's `pipe` pauses only on `false`, so `ServerResponse.write` returns `false` under
  backpressure, as Node's does (goal map §Regression risk). Its `'drain'` contract stays.
- **ADR-0238** (`Readable.from` object mode): the implementation. The behaviour is Node's
  `internal/streams/from.js`.
- **ADR-0240** (Writable internal/public completion phases): wholly. Node's `writable.js` defines
  the phases.
- **ADR-0353** (callable constructor boundary): wholly. Node's classes are function constructors;
  the `io-treeshake-side-effect` constraint it served is now §Consequences.
- **ADR-0020**: only the `createReadStream` mechanism, as in Decision 3.

Stays in force: ADR-0458 (io reads `node:process` through the registry factory); the bindings reach
`process` the same way.

## Alternatives

- **Route A**: keep rifty's streams and fix them per member in 8 units (this goal's first map). It
  could meet the invariants in principle. Rejected on delivery risk and §Simplicity: its unit graph had three hidden dependencies after one review, the same class that broke
  the zlib goal twice and PR #434 three times. Its numbers are the A column above.
- **`readable-stream` 4.x as a dependency**: it is Node's streams rebuilt for userland. Rejected: a
  package copy of a different build, not v24.16.0's files, and ADR-0574 already set the pinned-source
  pipeline. Used only as a size reference.

## Consequences

- rifty's stream behaviour is Node's by construction. A Node upgrade re-vendors the files, and the
  drift check reports binding anchors that moved.
- Size, measured: generic +23 686 B gzip (303 440 of 332 000).
  - The zlib engine measured +36 950 B gzip on generic (ADR-0573 §8). Together that is 340 390,
    which is 8 390 over the cap; toolchain comes to 383 798 of 386 000. This does not yet count
    zlib's handle and `lib/zlib.js`.
  - A lazy stream chunk is doubtful: `require('stream')` is synchronous, and the core is needed at
    boot (child stdio, `process-file-stdout`, `IncomingMessage`).
  - The cap conflict between the two goals is the user's to decide (goal map §Open questions); the
    cap is not raised without them.
  - `main`/`sw` stay clean only while the module stays a pure IIFE (trap `io-treeshake-side-effect`).
  - `guest.js` grows by +24.8 KB gzip, before the isolate's `AbortController` binding (≈9 KB gzip,
    `results/route-b-size.txt`).
- Hand-written stream tests go. Their place: differential + parity + carrier, plus regression rows
  per internal stream kind (goal map §Regression risk).
- Isolate gains a core-private `AbortController`. Guest code sees its `signal` objects only as
  arguments (pipeline stages, `map`/`filter`), not as a global.

## Open

Entry criteria of the core unit (goal `map.md`):

- the generic budget with the zlib engine: the user's decision (above);
- Chromium, including the 108 floor: the m-matrices and the carrier on route B on both browser
  hosts, plus `check:es-floor` on the generated module and bindings;
- the isolate's `AbortController` binding (Decision 6); until it exists, `pipeline` fails there on
  route B.
