---
area: runtime-js
status: draft
title: Node's lib/zlib.js, whole, with crc32 and the engine entering the bundles, runs on rifty once rifty's Transform equals Node's on every zlib path
created: 2026-11-24
why: Node's zlib classes are Transform subclasses — option validation, errored/closed, destroy → _destroy, readableFlowing are Transform state — so lib/zlib.js is faithful in rifty only on a Node-equal Transform
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md, docs/backlog/runtime-js/stream-destroy-construct-hooks.md, docs/backlog/runtime-js/zlib-crc32.md, docs/backlog/runtime-js/zlib-trailing-bytes-after-stream-end.md, docs/backlog/runtime-js/zlib-class-call-shape.md, docs/backlog/runtime-js/zlib-web-compression-subset.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts, packages/io/src/streams/transform.ts]
---

## Context

Unit 3 of the goal, after the streams goal's core (thread `t3/node-streams-goal`; the parts it needs
are in the map) and merged right after unit 2. Node v24.16.0's `lib/zlib.js` whole — the 7 classes as
callable legacy constructors over `ZlibBase`/`Zlib`, the 7 one-shots with callbacks and
`util.promisify`, the 7 `*Sync`, `create*`, `crc32` (its `binding.crc32` the engine's), `info`,
`params`/`reset`/`flush`/`close`, `_processChunk` and the internals pngjs reads — over unit 2's handle,
on every host. Here the engine enters the bundles for the first time. Today's browser
`Gzip`/`CompressionStream` path leaves `node:zlib` in the same step (ADR-0159/0178 superseded; no state
with two engines), and with it the isolate guest's `NO_ENGINE` reason. The `FinalizationRegistry` of
ADR-0573 §6 frees a dropped object's handle as Node's `MakeWeak` does. Absorbs `runtime-js/zlib-crc32`,
`runtime-js/zlib-trailing-bytes-after-stream-end`, `runtime-js/zlib-class-call-shape` and the rest of
`runtime-js/zlib-web-compression-subset`.

Entry criterion — the state group of `zlib-diff.mjs` (Node's `lib/zlib.js` verbatim from the pinned
tarball, identical to the binary's builtin source, over the probe handle; `stream.Transform` and the
stream helpers = Node's vs rifty's; everything else Node's) shows 0 differences between `port/N` and
`port/R`, or only rows already declared in compat `streams.md` with their number. The scenarios are
the paths I1–I4 promise, including guards that are equal today; the load group belongs to unit 4 (on the streams goal's route B it is 0/1, so unit 4 may become a guard).
Today on main (`results/zlib-diff.txt`): `port/N` = real Node in the state group 45/45 and the load group 1/1 (stable field: the `'drain'` count); state group `port/R` ≠ `port/N`
in 26/45 scenarios, 154 fields; load group 1/1 (one `'drain'` more):

| rifty `Transform` gap | scenarios hit | Node | rifty |
|---|---|---|---|
| `Symbol.asyncDispose` | surface | `function` | `undefined` |
| constructor option validation | `highWaterMark: -1`, `signal: 1` | `ERR_INVALID_ARG_VALUE`, `ERR_INVALID_ARG_TYPE` | compresses |
| `_destroy` never runs, so the handle never closes | sync error, `close()`, `close(cb)` ×3, missing dictionary, `rejectGarbageAfterEnd`, destroy mid-write | `_closed: true`, `_handle: null`; after a sync error `reset()` → `ERR_INTERNAL_ASSERTION`, the next `_processChunk` → `TypeError …writeSync` | handle open; `reset()` passes; the next `_processChunk` throws the previous `Z_DATA_ERROR` again |
| `autoDestroy` after `'end'` | every stream that ends | `destroy()` → `_destroy` → `'close'`, `destroyed: true` | no destroy, no `'close'` |
| `errored`, `closed`, `readableFlowing` | every scenario reading them | the error / `true`·`false` / `null`·`true` | `null` / `undefined` / `undefined` |
| `finished` on a closed stream | `close(cb)` before writing, after a write, «after an error» (the probe's label: the inflate's output is unread and held at its `highWaterMark`, so it has not ended; after a real stored error Node passes that error instead) | `ERR_STREAM_PREMATURE_CLOSE` | `cb()` |
| `write(chunk, '', cb)` (Node's `flush()` marker) | `flush()` default, `Z_SYNC_FLUSH`, `Z_FULL_FLUSH`, `Z_BLOCK`, `Z_PARTIAL_FLUSH`, `params()` | accepted with the default encoding | `ERR_UNKNOWN_ENCODING: ''`; the flush is lost and the output differs |
| `'end'` / `'finish'` order | inflate with a trailing tail | `'end'` before `'finish'` | `'finish'` before `'end'` |

Equal today, kept as guards: `chunkSize`/`windowBits`/`level`/`dictionary` validation, call without
`new`, `Inflate.call(this)` + `_processChunk`, `class extends DeflateRaw`, sync bytes and
`maxOutputLength`, the callback forms, `unzip`, dictionary round trip, `pipe`, async iteration,
`pipeline`, `finished` after end.

Carrier cases expected green after this unit: all ten — 1, 2, 3w, 3r, 4, 5a, 5b, 6, 7a, 7b. A
delegate's run of Node's verbatim `lib/zlib.js` over rifty's `Transform` (round 3 review) gave Node's
output for exceljs (5000 rows), unzipper, pngjs and pdfkit, the libraries' own streams being Node's.

## Acceptance

Draft until its dependency lands; seeds the compile:

1. Entry: `zlib-diff.mjs` state group = 0 differences on `main` (or only declared compat
   `streams.md` rows with their number) → I1, I3, I4
2. Exit: the same scenarios against the product `node:zlib` inside the isolate host and in a Chromium
   Worker of both browser hosts give real Node's results → I1–I4
3. All ten carrier cases green on every host → scenario, I5. Known carrier risk: on the Workbench
   the runner returns a step's output as one base64 line on terminal stdout (≈273 KB for
   `out.png`), unexercised while no step writes
4. `crc32` via Node's `lib/zlib.js` over the engine's `binding.crc32` (closes `runtime-js/zlib-crc32`) → I1
5. The engine compiles on the first call that needs it, never when the builtins load: a per-PR test on
   current Chromium instruments `WebAssembly.Module`, `Instance`, `compile`, `instantiate`,
   `compileStreaming`, `instantiateStreaming` and fails if importing the builtins creates any; a
   separate observation that the first zlib call compiles exactly once and later calls reuse the
   instance; a Chromium 108 floor-lane run recorded once in the PR body (manual: `browser-floor.yml` is
   dispatch-only) → ADR-0573
6. Before wiring, measured: whether `zlib` can leave the client generic eager graph with
   `require('zlib')` still synchronous; either way `pnpm test:client-bundles` stays under every cap,
   cause and numbers in `client-bundle-budget.mjs`'s note → ADR-0573
7. The `FinalizationRegistry` frees dropped objects' handles: a GC-lane test (`--expose-gc`) sees the
   allocator reuse their blocks → ADR-0573
8. ADR-0159/0178 marked superseded; compat `zlib.md`/`isolate-host.md` rows rewritten → ADR-0573

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); re-cut after rounds 2 and 3 of the external review of PR #448
