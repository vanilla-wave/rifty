---
area: runtime-js
status: draft
title: Node's lib/zlib.js, whole, runs on rifty over the zlib handle once rifty's Transform equals Node's on every zlib path
created: 2026-11-24
why: Node's zlib classes are Transform subclasses — option validation, errored/closed, destroy → _destroy, readableFlowing are Transform state — so lib/zlib.js is faithful in rifty only on a Node-equal Transform
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md, docs/backlog/runtime-js/stream-destroy-construct-hooks.md, docs/backlog/runtime-js/zlib-trailing-bytes-after-stream-end.md, docs/backlog/runtime-js/zlib-class-call-shape.md, docs/backlog/runtime-js/zlib-web-compression-subset.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts, packages/io/src/streams/transform.ts]
---

## Context

Unit 3 of the goal, after the streams goal's core (thread `t3/node-streams-goal`; the parts it needs
are listed below and in the map). Node v24.16.0's `lib/zlib.js` whole — the 7 classes as callable
legacy constructors over `ZlibBase`/`Zlib`, the 7 one-shots with callbacks and `util.promisify`, the 7
`*Sync`, `create*`, `info`, `params`/`reset`/`flush`/`close`, `_processChunk` and the internals pngjs
reads — over unit 2's handle, on every host. Today's browser `Gzip`/`CompressionStream` path leaves
`node:zlib` in the same step (ADR-0159/0178 superseded; no state with two engines). The
`FinalizationRegistry` of ADR-0573 §6 frees a dropped object's handle as Node's `MakeWeak` does.
Absorbs `runtime-js/zlib-trailing-bytes-after-stream-end`, `runtime-js/zlib-class-call-shape` and the
rest of `runtime-js/zlib-web-compression-subset`.

Entry criterion — one differential, not a list of cases: `zlib-diff.mjs` (Node's `lib/zlib.js` loaded
verbatim from the pinned tarball over the probe handle, `stream` = Node's vs rifty's `Transform`) shows
0 differences between `port/N` and `port/R` on every scenario, or only rows already declared in compat
`streams.md` with their number. Today on main (`results/zlib-diff.txt`): `port/N` = real Node 16/16;
`port/R` ≠ `port/N` in 10/16 scenarios, 48 fields:

| rifty `Transform` gap | scenarios hit | Node | rifty |
|---|---|---|---|
| constructor option validation | `highWaterMark: -1`, `signal: 1` | `ERR_INVALID_ARG_VALUE`, `ERR_INVALID_ARG_TYPE` | compresses |
| `_destroy` never runs (so the handle never closes) | sync error, `close()`, `close(cb)`, destroy mid-write | `_destroy` → `_closed: true`, `_handle: null`; `reset()` → `ERR_INTERNAL_ASSERTION`; next call → `TypeError …writeSync` | handle open; `reset()` ok; next call computes |
| `autoDestroy` after `'end'` | callback/stream success | `destroy()` → `_destroy` → `'close'`, `destroyed: true` | no destroy, no `'close'` |
| `errored` | sync error | the error | `null` (no getter) |
| `closed` | every scenario reading it | `true`/`false` | `undefined` |
| `readableFlowing` | every scenario reading it | `null`/`true` | `undefined` |
| `finished` on a stream closed before writing | `close(cb)` | `ERR_STREAM_PREMATURE_CLOSE` | `cb()` |
| `write(chunk, '', cb)` (Node's `flush()` writes its marker with encoding `''`) | `flush(kind, cb)` | accepted (default encoding) | `ERR_UNKNOWN_ENCODING: ''` |

Carrier cases expected green after this unit: 3 write, 3 read, 4, 5a `gunzipSync`, 5b `unzip`, 7b
callback `inflate`; 1 (exceljs), 2 (unzipper), 6 (ws) here or in unit 4 — the carrier's run decides.

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); re-cut after round 2 of the external review of PR #448
