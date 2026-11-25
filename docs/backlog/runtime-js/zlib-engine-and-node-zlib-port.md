---
area: runtime-js
status: ready
title: The wasm zlib engine under a port of Node's handle and whole lib/zlib.js gives Node's sync forms, crc32 and classes on every host
created: 2026-11-24
why: Node's one-shots, sync forms and classes are all lib/zlib.js over one native handle; the sync half needs no stream machinery and is deliverable before the streams goal
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md, docs/backlog/runtime-js/zlib-trailing-bytes-after-stream-end.md, docs/backlog/runtime-js/zlib-crc32.md, docs/backlog/runtime-js/zlib-web-compression-subset.md, docs/backlog/runtime-js/zlib-class-call-shape.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts]
---

## Context

Unit 2 of the goal, cut by Node's structure (manager 2026-11-24): in Node v24.16.0 every one-shot is
`new ctor(opts)` (`lib/zlib.js:786-799`) — sync forms run `processChunkSync` straight on the handle,
callback forms run `zlibBuffer` (`:113-129`: `on('data'|'error'|'end')` + `end(buffer)`, errors via
`destroy()`). So this unit ports `node_zlib.cc` ZlibContext as the handle and `lib/zlib.js` whole,
classes included, over ADR-0573's engine, on browser Workers and in the isolate guest (its
`ceiling-zlib.ts` members become this). Probe: `docs/backlog/runtime-js/reference/zlib-engine-probe/`.

Measured on main (`results/transform-path.txt`, `lib/zlib.js` ported over a `Transform` parameter):

| what the path takes from `Transform` | Node | rifty `Transform` today | wall |
|---|---|---|---|
| `Transform.call(this, opts)` construction, legacy call shape | yes | as Node | no |
| `end(buffer)` → `_transform` with Node's last-chunk flag (`writableEnded && writableLength`) | `write(0)…write(4)` | same flag sequence | no |
| `push` / `'data'` / `'end'` / bytes / `info.engine` | — | as Node (7/7 scenarios) | no |
| error → `destroy(err)` → `'error'` → callback → `'close'` order | — | as Node | no |
| `destroy()` → `_destroy(err, cb)` → handle `close()` | always | **never runs**: handle stays open after every async one-shot and every sync error | `runtime-js/stream-destroy-construct-hooks` |
| `close()` after `maxOutputLength` stops the engine | 1 write | 2 writes (no `_destroy`) | same |
| sync success path closes the handle itself (`processChunkSync` → `_close`) | yes | as Node | no |

Probe facts on the wasm build: 1420/1420 matrix (incl. `crc32` 32/32, `windowBits: 8`); Node's own
`test-zlib*.js` through a swapped handle 62/62 (36 deflate-family files write through the engine —
an API-shape proof; bytes are the matrix's); pdfkit and pngjs sync byte-identical
(`results/consumers.txt`); Chromium 108 Worker sync compile and round trip (`results/chromium108.txt`).

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge) and the external review rounds of PR #448; re-cut after round 1's B1

## Acceptance

1. The 7 sync forms (`deflateSync`, `inflateSync`, `gzipSync`, `gunzipSync`, `deflateRawSync`,
   `inflateRawSync`, `unzipSync`) run on the browser hosts and in the isolate guest and give Node's
   bytes for every option of the probe matrix (`level`, `memLevel`, `strategy`, `windowBits` incl. 0
   and 8, `dictionary`, `chunkSize`, `finishFlush`, `maxOutputLength`), gzip OS byte 3 → I1, I2
2. Their errors are Node's — message, class, `code`, `errno` — on corrupt, truncated, wrong-format,
   missing/wrong-dictionary input and on invalid arguments (Node's `ERR_INVALID_ARG_TYPE` /
   `ERR_OUT_OF_RANGE` before the engine runs) → I3
3. Decoding follows Node past the stream end: zlib/raw tails ignored, gzip zero padding and multiple
   members, `unzipSync` sniffing gzip vs zlib (closes the sync half of
   `runtime-js/zlib-trailing-bytes-after-stream-end`) → I2
4. `info: true` on a sync form returns `{ buffer, engine }` with `engine instanceof` its class → I4
5. `zlib.crc32(data[, value])` gives Node's values and Node's argument errors on every host (closes
   `runtime-js/zlib-crc32`) → I1
6. The 7 classes construct as Node's: with `new`; without `new` (one DEP0184 per realm); `util.inherits`
   + `X.call(this, opts)` initializing in place; `name`/`length` and the chain `X` → `Zlib` →
   `ZlibBase` → `Transform` (closes the construction rows of `runtime-js/zlib-class-call-shape`) → I1
7. pngjs 7 `PNG.sync.read` works over the internals it reads (`_handle.writeSync`, `_writeState`,
   `_outBuffer`, `_outOffset`, `_chunkSize`, `_processChunk`, `_finishFlushFlag`); carrier steps 3, 4,
   5 (`gunzipSync`) and 7 (`crc32`) turn green on every host → I4, scenario
8. The engine is compiled on the first call that needs it, never when the builtins load: a floor-lane
   case on Chromium 108 imports the builtins on the page main thread and fails if `zlib` compiles or
   instantiates wasm there; a Chromium 108 Worker case runs a sync form → ADR-0573
9. The `FinalizationRegistry` frees a handle left open after a sync error and a class instance dropped
   without `close`: a GC-lane test (`--expose-gc`) sees the allocator reuse their blocks → ADR-0573
10. Every engine pointer is checked: a failed allocation is a loud error, with a test that exhausts
    the wasm memory → ADR-0573
11. `zlib.wasm` is rebuilt on the Linux CI runner from the sha256-pinned Node tarball by a pinned
    toolchain (release + digest) and matches the committed sha256; the binary (Zlib + Chromium BSD-3)
    and the ported Node code (MIT) are in the licence record (`vendor/`/`generated/` manifest of PR #445)
    → ADR-0573
12. Before wiring, measured: whether the builtin `zlib` module (engine included) can leave the client
    generic eager graph without changing `require('zlib')`'s synchronous semantics; with or without it,
    `pnpm test:client-bundles` stays under every cap, the cause and the numbers in
    `client-bundle-budget.mjs`'s note → ADR-0573
13. The callback one-shots and `createGzip` are unchanged per host (browser: `CompressionStream`;
    isolate: `NotImplementedError('isolate-host.zlib.<member>')`): their existing conformance and
    isolate rows stay green unmodified → ADR-0573
14. compat `zlib.md` and `isolate-host.md` rows say what landed and declare the residuals below with
    their numbers → ADR-0573

## Parity cases

Oracle: Node v24.16.0 (`node -e` / parity-runner, live). Artifact base: the probe's `cases.mjs`
groups, re-expressed as rifty parity cases.

1. Compressed bytes, sync, per format × level (−1, 0…9) × input (empty, 5 B, 64 KiB text, 100 KB
   JSON, 16 KiB random, 100 KB zeros, 300 KB mixed) → I2
2. `strategy` 1–4, `memLevel` 1/4/9 × `windowBits` 8/9/12/15, `chunkSize` 64/1024/65536 at levels
   0/6, `dictionary` for zlib and raw → I2
3. Inflate: valid; tails `\n`, `\r\n`, `JUNK!`, 8×0x00, `1f`, a gzip header; truncation at 0, 1, 2,
   3, 10, half, −4, −1; one byte flipped at 10 positions; 900 seeded corruptions → I2, I3
4. `finishFlush: Z_SYNC_FLUSH` on truncated input (partial output), `maxOutputLength` 1000
   (`RangeError` `ERR_BUFFER_TOO_LARGE`) → I3
5. gunzip of 2 members, member + zeros + member, member + junk + member; `unzipSync` of gzip, zlib,
   raw and of one `1f` byte → I2, I3
6. `windowBits`: inflate 9/12 of a w15 stream, 0 (auto) of w15 and w9, gunzip 0, raw 9 of a w15
   stream → I2, I3
7. Wrong format: inflate of raw, gunzip of zlib, inflateRaw of zlib; dictionary missing, wrong,
   right (zlib and raw) → I3
8. `crc32` over the seven inputs × initial value 0, 1, 0xffffffff, 0x12345678; invalid `data` and
   `value` → I1
9. `info: true` shape on each sync form; class construction three ways with DEP0184 once; `name`,
   `length`, prototype chain → I1, I4
10. pngjs `PNG.sync.write` + `PNG.sync.read` of a 300×200 image; pdfkit compressed document with a
    frozen clock → I4, scenario

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| wasm compile/instantiate fails on first use | the calling sync form throws a named error; no fallback engine | inject a corrupt module in a unit test | → ADR-0573 |
| zlib's own allocation fails (realm wasm space exhausted) | Node's `Zlib error` `Z_MEM_ERROR` through the handle's error path | open streams until 4 GiB (`streams-cap.mjs`), unit test | → ADR-0573 |
| the port's buffer allocation fails | loud `RangeError`, never a write at address 0 | Acceptance 10 | → ADR-0573 |
| handle open after a sync error / dropped instance | freed at GC by the `FinalizationRegistry` | Acceptance 9 | → ADR-0573 |
| isolate guest exceeds the worker RSS ceiling through engine memory | `termination: 'memory'` (ADR-0563) | an isolate case holding ≈ 1400 deflate instances at 64 MiB | → ADR-0573 |

## Out of scope

- The callback one-shots (`deflate`, `inflate`, `gzip`, `gunzip`, `deflateRaw`, `inflateRaw`, `unzip`
  with a callback or `util.promisify`), `createGzip`/`Gzip` as a stream, and every class used as a
  stream (`write`/`end`/`pipe`/`flush`/`params`/`reset`/`close`): today's behaviour per host —
  `runtime-js/zlib-node-stream-classes` (unit 3).
- Brotli and zstd: `NotImplementedError` on every host, compat ❌ (manager's scoping, user confirmation
  pending).
- Node's output on Windows (no lane; goal Decisions); Firefox/WebKit lanes (ADR-0469 dispatched).
- The SDK page's own main-thread import on Chromium 108 (`runtime-js/chromium108-sdk-sync-wasm-import`).

Declared residuals (compat rows land with this unit):
- a handle after a sync error is freed at garbage collection, not at the error — until the streams
  goal's first part (`_destroy`/`_construct` hooks, thread `t3/node-streams-goal`); lifted then by a
  check that the handle closes in `_destroy`;
- on a browser host, sync forms (engine, Node's bytes) and callback forms (`CompressionStream`) of the
  same call differ (`results/async-vs-sync.txt`, Chromium 148, 45 compress + 5 decode cases):
  compressed bytes identical in 14/45, identical but the gzip OS byte in 5 more (Chromium on macOS
  writes 19; the engine 3), different in 26/45 (`level` 1 and 9 are ignored by `CompressionStream`); the
  callback form's output always decodes on the engine (45/45). Decoding a 2-member gzip, gzip + 8 zero
  bytes, zlib + LF, zlib + `JUNK!`: the sync form gives Node's result, the callback form rejects
  `TypeError: Junk found after end of compressed data.` after the first member's bytes (4/4); a
  truncated stream: sync `Z_BUF_ERROR` `unexpected end of file`, callback `TypeError: Compressed input
  was truncated.`;
- open instances per realm: ≈ 14000 deflate in a Node process, ≈ 1400 at an isolate `memoryLimitMb` of
  64 (computed); linear memory is not returned after close (goal Decisions).

## Decisions

- 2026-11-24 — manager: units cut by Node's structure; this unit ports `lib/zlib.js` whole and accepts its sync half.
- 2026-11-24 — manager: the callback one-shots and `createGzip` stay as on main per host until unit 3 or the post-`_destroy` add-on (map); a throw in place of working behaviour is a fake (AGENTS.md §Fidelity).
- 2026-11-24 — manager: the sync error path ships here; its handle is freed by the `FinalizationRegistry`; `lib/zlib.js` is not patched around the missing `_destroy` (no own `_close` in a `catch`).
- 2026-11-24 — manager: engine and placement per ADR-0573 (inline, lazy, one instance per realm); gzip OS byte 3 (goal Decisions).
- The matrix (bytes) and Node's own `test-zlib*.js` (API shape, through the handle) are both carriers; neither replaces the other.
