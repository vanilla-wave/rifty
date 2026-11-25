# Map — node-zlib-on-every-host

Units are cut by Node's own structure (manager 2026-11-24, after the external review of PR #448):
every one-shot in Node is `new ctor(opts)`; sync forms run the handle directly, callback forms and
streams ride `Transform`.

## Items

1. `runtime-js/zlib-node-acceptance-carrier` — **carrier** — the User scenario step by step as parity
   cases (isolate sandbox and both browser hosts vs a live `node` on the same runner), each pinning
   today's named outcome; first, before engine code. Says which cases each later unit turns green.
2. `runtime-js/zlib-engine-and-node-zlib-port` — **engine + handle + `lib/zlib.js`, sync half** —
   ADR-0573's engine under a port of Node's handle and whole `lib/zlib.js` (classes included) on
   every host. Accepted: `*Sync`, `info` on sync forms, `crc32`, class construction (`new`, no `new`,
   `X.call(this)`), `_processChunk` (pngjs) — carrier steps 3, 4, 5 (`gunzipSync`), 7 (`crc32`).
   Callback one-shots and `createGzip` stay as on main per host (they ride `_destroy`, measured wall
   below). Absorbs `runtime-js/zlib-crc32`, `runtime-js/zlib-trailing-bytes-after-stream-end` (sync
   half), `runtime-js/zlib-class-call-shape` (construction). → I1 (sync, `crc32`, construction), I2, I3
   (sync), I4 (`_processChunk`/`_handle`/`_writeState`), scenario 3–5, 7.
3. `runtime-js/zlib-node-stream-classes` — **classes as streams + callback one-shots** — after the
   streams goal (the wall of parked PRs #434/#437, waiting on the user), not before and not with
   stream gaps declared: `write`/`pipe`/`flush`/`params`/`close`, backpressure, destroy mid-write,
   event order, the 7 callback one-shots and `util.promisify`; `CompressionStream` leaves `node:zlib`.
   Absorbs the rest of `runtime-js/zlib-web-compression-subset` and of the trailing-bytes item.
   → I1, I3, I4, I5, scenario 1, 2, 5 (`unzip`), 6, 7 (callback).

Wall measured on main (`docs/backlog/runtime-js/reference/zlib-engine-probe/results/transform-path.txt`,
Node's one-shot path ported over a `Transform` parameter): over rifty's `Transform` every
Node-observable result of 7 one-shot scenarios is Node's — bytes, error message and `code`,
`info.engine`, callback/event order — but `_destroy` never runs, so the handle is not closed after an
async one-shot or any error (`runtime-js/stream-destroy-construct-hooks`). Not measured: backpressure
and event order over these classes (`runtime-js/transform-readable-backpressure`,
`runtime-js/duplex-end-finish-close-order`). Streams are not fixed inside zlib.

## Open questions

- Whether unit 2 ships the sync error path, whose handle only the `FinalizationRegistry` frees while
  `_destroy` does not run (Node-observable results equal, `transform-path.txt`), or keeps it for unit 3
  — owner: agent — the manager's call before unit 2 is compiled.
- Whether Node's own `test/parallel/test-zlib*.js` can run inside rifty as an extra parity corpus
  (in real Node 36 of its 47 deflate-family files write through the engine) — owner: agent — a trial
  run of `test/common` in the isolate host during unit 2.

## Decisions

- Engine: the wasm build of Node v24.16.0's `deps/zlib` on every host — ADR-0573 accepted by the
  manager 2026-11-24 under the user's delegation («исследуй и запускай»), not the user's choice.
  Ground: the only candidate at 1420/1420 and Node's suite 62/62 with no zlib code written in rifty
  (pako needs a rifty `deflateParams` port and a rifty `crc32`); no difference observable against Node.
- Order: units 1–2 now, in a thread from `main` after this map merges; unit 3 after the streams goal.
- On main the callback one-shots work on browser hosts over `CompressionStream` (ADR-0159, ⚠️) and
  `createGzip` too (ADR-0178): they keep that until unit 3 — a throw in place of working behaviour is a
  fake (AGENTS.md §Fidelity). In the isolate they stay `NotImplementedError` until unit 3.

## Out of scope

- Brotli (`brotliCompress`/`…Sync`/`createBrotli*`/`BrotliCompress`/`BrotliDecompress`) and zstd
  (`zstdCompress`/`…Sync`/`createZstd*`/`ZstdCompress`/`ZstdDecompress`): `NotImplementedError` on
  every host, compat ❌ — manager's scoping, user confirmation pending.
- The gzip header OS byte of a macOS or Windows Node (19 / 10): rifty writes 3 (goal Decisions).
- The SDK page's own main-thread import on Chromium 108 (`runtime-js/chromium108-sdk-sync-wasm-import`).
