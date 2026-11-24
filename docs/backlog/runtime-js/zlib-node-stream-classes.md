---
area: runtime-js
status: draft
title: node:zlib's stream classes and create* factories are Node's lib/zlib.js over the shared handle, on every host
created: 2026-11-24
why: exceljs, unzipper, ws and pngjs reach zlib through streams, legacy constructor calls and Node's internals; only Gzip exists today, browser hosts only
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/zlib-class-call-shape.md, docs/backlog/runtime-js/zlib-web-compression-subset.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts, packages/io/src/streams/callable-constructor.ts]
---

## Context

Unit 3 of the goal, after `zlib-engine-one-shots` (same handle). `ZlibBase`/`Zlib` and the 7 classes as
Node's callable legacy constructors (DEP0184 once on a call without `new`; `X.call(this)` initializes in
place — closes `zlib-class-call-shape`), the 7 `create*`, `_transform`/`_flush`/`_final`,
`processCallback`'s output-buffer and push protocol, `flush(kind, cb)`, `params`, `reset`, `close`,
`bytesWritten`, `_closed`, `rejectGarbageAfterEnd`, and the internals pngjs reads. Isolate guest: the
loud classes in `ceiling-zlib.ts` become these, keeping Node's chain. Flips the exceljs
"named gap" row in `library-exceljs.test.ts` to Node's bytes.

Probe facts: exceljs streaming writer, unzipper (Open + Parse), ws permessage-deflate, pngjs sync
read — byte-identical under Node's `lib/zlib.js` on both engines (`results/consumers.txt`). Not
measured: the same over rifty's `Transform` — no backpressure, no `_destroy`, `'finish'` before
pending `'data'` (`docs/public/compat/streams.md`); Node's `processCallback` defers the next write
on a full readable buffer (`self._read` swap), and zlib's `_destroy` closes the handle (frees the
engine state, ADR-0573 §6). Which of these the carrier hits is the run's finding.

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); findings 3, 5, 6, 12 touched these drafts and are fixed.
