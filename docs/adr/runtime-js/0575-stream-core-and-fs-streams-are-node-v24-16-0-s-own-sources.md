# ADR 0575: Stream core and fs streams are Node v24.16.0's own sources

Status: Accepted
Date: 2026-11

> TL;DR: `node:stream` is Node v24.16.0's own JS, unedited and generated from the pinned tarball:
> `lib/stream.js`, `lib/stream/promises.js` and `lib/internal/streams/*.js`. `fs.ReadStream` and
> `fs.WriteStream` come unedited from `lib/internal/fs/streams.js` and read and write through fds on
> every host. rifty supplies only the bindings. The hand-written `@riftydev/io` streams and their
> unit tests are retired in one step.
>
> The manager chose this route under the user's delegation (goal `node-streams-as-in-node`); the
> user confirmed it on 2026-11-25 («с решениями согласен», goal Decisions).

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
| m4 `fs.ReadStream`, m5 `fs.WriteStream` | 3/22, 5/15 | 18/22, 13/15 |
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

Cost on current `main` `692babe13` (`results/route-b-product-build-main.txt`; min / gzip bytes).
The earlier `b1270101a` record is `results/route-b-product-build.txt`.

| artifact | `main` | + route B | budget |
|---|---|---|---|
| `main` | 91 433 / 28 548 | 91 197 / 28 521 | 128 000 / 40 000 |
| `sw` | 16 711 / 5 848 | 16 475 / 5 805 | 23 000 / 8 000 |
| generic | 956 548 / 288 404 | 1 027 341 / 312 037 | 1 124 000 / 332 000 |
| toolchain | 1 085 625 / 331 931 | 1 155 135 / 355 626 | 1 284 000 / 386 000 |
| `guest.js` (esbuild-minified) | 4 429 133 / 1 275 340 | 4 504 922 / 1 300 132 | — |

- `test:client-bundles` passes, including the io ≤ 5120 B guard of `main`/`sw` (950/1021 B). It was
  not run through `check:es-floor`.
- The generated module is lazy CJS functions inside a `/* @__PURE__ */` IIFE; a named top-level
  factory leaked through esbuild's `keepNames`.
- Why +23.6 KB and not the per-file estimate of +7.6 KB. These are marginal gzip bytes of the
  generated module, 38 563 B in all:
  - core 23 678;
  - Node's internals cut down to the statements read, 7 343: errors 4 477, util 1 302, validators 763,
    fs/utils 478, url 129, assert 96;
  - `webstreams/adapters` 3 123;
  - `fs/streams` 2 213;
  - `duplexpair` 315, which is new behaviour;
  - `abort_listener` 227.

  Against that, rifty's own streams go: io 11 064 and `fs-streams.ts` 4 359. Almost nothing can be
  dropped without dropping behaviour. The levers are organisational: the cap, the zlib engine as its
  own file, and the order of the two goals.
- 10⁵ one-byte writes: Node 5 ms, route A 41 ms, route B 22 ms (`results/route-b-bench.txt`,
  regenerated).

## Decision

1. Vendor these Node v24.16.0 files under `tools/publishing/node-streams/`, pinned by sha256 with
   Node's `LICENSE`, and generate them the ADR-0574 way: exact-once anchors only for binding
   inputs, plus a drift check.
   - `lib/stream.js`, `lib/stream/promises.js`;
   - `lib/internal/streams/*.js`, except `fast-utf8-stream.js` and `lazy_transform.js`, which nothing in
     the set requires (17 of 19);
   - `lib/internal/fs/streams.js`;
   - `internal/assert`, `internal/events/abort_listener` and `internal/webstreams/adapters` whole;
   - `internal/{errors,validators,util,fs/utils,url}` as the statements the others read (Node's `E()`
     texts).

   That is 28 modules: 23 whole files and 5 cut down.

   Minify keeps identifiers: renaming changes V8's own `TypeError` text (parity `from-web-options`).
   (8a: no minifier in the generator at all, §2 note 2026-11-26.)
   The Workbench consumer build renames, and that was measured: renamed, 1 of 105 parity cases run
   changes, `from-web-options` (5 more skipped on both builds; `results/route-b-minify.txt`). Map 8c
   keeps identifiers there or declares the row, with one guard row on the consumer bundle. The generator needs `acorn` as a dev dependency.

   License: an entry in `tools/publishing/third-party-manifest.json` (PR #445's mechanism), as for
   ADR-0574. Nothing is published before that entry exists (map 8a).
2. Bindings, and nothing else hand-written. `primordials` are built as `url-legacy/bindings.ts`
   builds them: name and `length` are checked against Node's, and 8a's differential covers the
   behaviour. Node's own internals are cut down verbatim, statement by statement:
   - `internal/errors`: the 26 codes the files use, `AbortError`, `aggregateTwoErrors`; Node's `E()`
     texts;
   - `internal/validators` (10 functions);
   - `internal/util` (as generated, 8a: `deprecate`, `isWindows`, `kEmptyObject`, `normalizeEncoding`,
     `once`, `promisify`, `setOwnProperty`);
   - `internal/util/types`, `debuglog`, `assert`;
   - `internal/buffer.FastBuffer`, which is rifty's `Buffer`;
   - `internal/event_target` symbols;
   - `internal/events/abort_listener` is not a binding: Node's file is taken whole (variant A of
     `runtime-js/stream-core-abort-listeners-host-event-target`). On a host `EventTarget` Node's
     `kResistStopPropagation` and `kWeakHandler` have no effect; which variant ships is that unit's
     decision, not this ADR's. `events.addAbortListener` for guest code is its own unit (map 3);
   - `internal/blob.isBlob`;
   - `internal/fs/utils` (`copyObject`, `getOptions`, `getValidatedFd`, `validatePath`);
   - `internal/url.toPathIfFileURL`;
   - `internal/fs/promises`: `FileHandle` is a named gap until rifty has it;
   - and what the generator's closure also reads: `internal/util/inspect`, `internal/encoding`,
     `internal/webstreams/{readablestream,writablestream,queuingstrategies}`,
     `internal/v8/startup_snapshot`, `internal/process/{task_queues,warning}`, and `internalBinding`
     `constants`/`stream_wrap`/`types`/`uv`. The last three throw as named gaps
     (`results/route-b-product-build.txt`).

   Hidden coupling: `adapters.js:94` reads `internalBinding('constants').zlib` at load, which today
   maps to `require('zlib').constants` (probe `bindings.ts:332-333`), so `toWeb`/`fromWeb` pull in
   zlib. 8a provides the constants without loading the zlib module.

   Named gap: on a host `EventTarget`, `internal/event_target`'s `kResistStopPropagation` and
   `kWeakHandler` have no effect (`abort_listener.js`, `operators.js:255` `reduce`, `:62` `map`).
   Owner: `runtime-js/stream-core-abort-listeners-host-event-target` (variants A–D, rows `m9`, `m10`).

   Chromium 108 (the tier floor, ADR-0469) lacks APIs this code reaches, so the bindings supply them
   or the core waits on a floor shim. `check:es-floor` and the floor lane prove it:
   - `AbortSignal.any` (`operators.js`; Chromium 116+);
   - `Symbol.dispose`/`Symbol.asyncDispose` (primordials);
   - no `Promise.withResolvers` at load (the probe's `bindings.ts` used it; Chromium 119+).

   rifty modules (`events`, `buffer`, `string_decoder`, `timers`, `async_hooks`, `fs`) are reached
   through the builtin registry's lazy lookup, as `io` streams do today (`readBuiltinUncached`). No
   new layer edge; `check:arch` unchanged.

   2026-11-26 (8a, PR #471): primordials and the host globals are captured when the bindings module
   evaluates, each primordial built as `per_context/primordials.js` builds it; a rifty module not
   registered throws by name (no fallback); the zlib constants are a data module in io. `check:arch`
   gains `node-stream-core-has-no-production-importer` for 8a's window; 8c removes it. `acorn` is runtime-js's
   own dependency (8.16.0, pinned by the generator), not a root one: a root `node_modules/acorn`
   changed the playground bundle (measured). The generated module is committed unminified: esbuild's
   `minifySyntax` dropped 9 of Node's function names and renamed a class (review of PR #471); the
   test holds every function reachable from the exports to Node's `name`/`length`.
3. `fs.ReadStream`/`fs.WriteStream` read and write through fds on every host. This replaces
   ADR-0020's «`createReadStream` rebuilds on `Vfs.openReadable`». The condition: positional fd I/O
   by range (map 4b/4c).
   - In Workbench today `fs.read`/`readSync`/`write`/`writeSync` by fd move the whole file on every
     call (`fs.ts:944`, `fs.ts:424-441`).
   - 16 MiB in 64 KiB calls takes 18.5–26 s to read and 50–82 s to write; Node takes 3–7 ms.
   - Without 4b/4c, this decision would regress today's linear `openReadable`/`writeFileSync`
     streams.

   `lib/internal/fs/streams.js` is one file for both classes; it is loaded whole. `fs.ReadStream`
   (map 9r) can ship before `fs.WriteStream` (9w): until 9w, `fs` keeps today's write class, and Node's
   `WriteStream` sits in the file unused. `Vfs.openReadable` stays a VFS
   API for its other users (shell `_sync-vfs`, workbench glue).
4. Each binding gap the probe found is fixed against Node as its own unit, before the unit that needs it
   (goal `map.md` order):
   - `string_decoder` encodings;
   - `Buffer`'s `normalizeEncoding`;
   - `events.addAbortListener` for guest code (the core uses Node's own file);
   - fs callbacks in an I/O turn rather than a microtask;
   - `fs.writev`/`fs.fsync`;
   - positional fd read and write by range (map 4b, 4c);
   - the cost of a write's publication in Workbench (map, the write side only).
5. Web adapters (`toWeb`/`fromWeb`): Node's `internal/webstreams/adapters` verbatim over the host's
   `ReadableStream`/`WritableStream`. Of the 14 parity cases using them, 13 equal Node; the 14th fails
   on `'UTF8'` (map unit 2). The isolate's
   `ReadableStream` ceiling stays as today.
6. Isolate host: the core's `AbortController`/`AbortSignal` (one per `pipeline` call, `signal`
   passed to function stages and helpers) come from Node's `lib/internal/abort_controller.js` +
   `internal/event_target.js`, verbatim. They are not installed as globals, but they are reachable:
   - `signal.constructor` is `AbortSignal` with its statics (`signal.constructor.any([])` makes a
     signal);
   - `Object.getPrototypeOf(AbortSignal.prototype).constructor` is a working `EventTarget`;
   - an event's `constructor` is `Event`;
   - meanwhile the globals stay ceiling throws, so `signal instanceof AbortSignal` throws.

   That is the fact, not a security property. Whether to make `AbortController`/`AbortSignal`/
   `EventTarget`/`Event` isolate globals from the same sources is the user's fork, carried with the
   Web API goal's question 1. Browser hosts bind the host globals.
7. The core lands in three adjacent PRs. No `main` ever runs two cores, and none holds an unwired
   core for an open-ended time. 8a and 8b merge only once 8c's PR is open and its CI differential is
   green.
   - 8a: generator, vendored sources and bindings, not wired. `check:arch` has no product importer,
     every bundle artifact gains 0 B, and a CI differential checks Node's bindings = rifty's over the
     rows `results/ownership.txt` gives to the core. Rows of later units stay pinned RED with their
     owner. `zlib-diff` is zlib unit 3's entry criterion, after 8c, not part of 8a.
   - 8b: regression rows for internal consumers and non-stream objects, green on today's core first.
   - 8c: wiring. Consumers move to Node's API (io's `onDestroy` for `Writable.fromWeb`,
     `ServerResponse.write` → `false` + `'drain'`, the stream shape `finished(req.socket)` needs).
     Hand-written `packages/io/src/streams` and its unit tests go.

Superseded:

Supersession takes effect when unit 8c lands; removals and §Corrections notes of the superseded
ADRs (per `docs/adr/README.md`) are part of 8c; until then they stay in force.

- **ADR-0034** (restoring Node's contract in rifty's streams): its stream parts. §1, the
  `'removeListener'` meta-event of `EventEmitter`, stays: `events` is a binding.
- **ADR-0069** (`setEncoding` through a streaming `TextDecoder`): wholly, D2/D3 included. Node
  decodes at `push` and re-decodes the buffer in `setEncoding`, so `length` counts characters
  (`readable.js:589-605`). rifty decodes at the emit boundary over a raw byte buffer.
- **ADR-0237** (read-hook dispatch and demand latch): wholly, its WHATWG-adapter part through
  Decision 5.
- **ADR-0239** (`fromWeb` staged validation, valid signals a loud gap): wholly; Node's adapters
  validate.
- **ADR-0154** (HTTP stream interop and drain contract), the parts tied to rifty's own streams:
  - item 1, `write()` typed `boolean | Promise<boolean>`: `ServerResponse.write` returns `false`
    under backpressure, as Node's does;
  - item 2, `fromWeb` in io: Node's adapters replace it;
  - `Readable.pipe` pausing on a `Promise`: Node's `pipe` pauses only on `false`;
  - its Tests that assert these.

  Its `'drain'` emission stays.
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
- Size, on `main` `692babe13`:
  - generic +23 633 B gzip (288 404 → 312 037 of 332 000);
  - toolchain +23 695 (331 931 → 355 626 of 386 000).

  With the zlib engine and its handle wired: generic 351 690 and toolchain 394 735 — review
  measurement of 25.11 (PR #450 reviewer, one build with #452's engine; not rerun here, no script in
  `results/`), which is +19 690 and +8 735 over the caps, before `lib/zlib.js` itself.
  - A lazy stream chunk is doubtful: `require('stream')` is synchronous, and the core is needed at
    boot (child stdio, `process-file-stdout`, `IncomingMessage`).
  - The cap is the user's question (goal map §Open questions), and it is not raised without them.
  - `main`/`sw` stay clean only while the module stays a pure IIFE (trap `io-treeshake-side-effect`).
  - `guest.js` grows by +24 792 B gzip, before the isolate's `AbortController` sources (≈9 KB gzip,
    `results/route-b-size.txt`).
- The Chromium 108 floor needs `AbortSignal.any`, `Symbol.dispose`/`asyncDispose` and
  `Promise.withResolvers`; the core calls the last at run time (`duplexify.js:212`, `adapters.js`).
  `check:es-floor` does not know them today, so 8c extends its lists and/or runs the 108 lane on
  these rows.
- Hand-written stream tests go. Their place: differential + parity + carrier, plus regression rows
  per internal stream kind (goal map §Regression risk).
- The isolate gains Node's `AbortController` sources, reachable through `signal.constructor`
  (Decision 6).

## Open

These are entry criteria of the core units (goal `map.md`):

- the user's answer on the generic and toolchain caps (above);
- the user's answer on isolate `AbortController` globals (Decision 6);
- route B in Chromium: SDK 12/12 programs = Node, Workbench 7/7 programs plus the 5 closure programs
  5/5 via `/tmp` (`results/chromium-b/`, `results/chromium-c/route-b/`); Chromium 108 not run;
- abort listeners on a host `EventTarget`: variant choice A–D
  (`runtime-js/stream-core-abort-listeners-host-event-target`), D with the user's globals question;
- positional fd I/O by range: 4b before 9r, 4c before 9w.
