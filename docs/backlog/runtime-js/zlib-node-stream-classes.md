---
area: runtime-js
status: draft
title: node:zlib's classes work as Node's streams and the callback one-shots move onto them, on every host, after the streams goal
created: 2026-11-24
why: exceljs, unzipper, ws and the callback one-shots reach zlib through stream machinery rifty's Transform does not yet give as Node (no `_destroy`, no backpressure)
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/stream-destroy-construct-hooks.md, docs/backlog/runtime-js/transform-readable-backpressure.md, docs/backlog/runtime-js/duplex-end-finish-close-order.md, docs/backlog/runtime-js/zlib-web-compression-subset.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts, packages/io/src/streams/transform.ts]
---

## Context

Unit 3 of the goal, after the streams goal (the wall of parked PRs #434/#437, waiting on the user).
The classes from unit 2 used as streams: `write`/`end`/`pipe`, `flush(kind, cb)`, `params(…, cb)`,
`reset`, `close(cb)`, `bytesWritten` timing, backpressure (`processCallback`'s `self._read` swap when
`push` returns false), destroy mid-write, event order; the 7 callback one-shots and `util.promisify`
over `zlibBuffer`; `CompressionStream` leaves `node:zlib` (ADR-0159/0178 superseded). Flips the
exceljs "named gap" row in `library-exceljs.test.ts`; unzipper, ws permessage-deflate.

Walls measured on main (`results/transform-path.txt`): rifty's `Transform` never runs `_destroy`, so
no handle closes after an async one-shot or an error. Not measured here: backpressure and event order
over these classes (compat `streams.md`: `runtime-js/transform-readable-backpressure`,
`runtime-js/duplex-end-finish-close-order`). Streams are fixed in their own goal, not inside zlib; this
unit does not close I4/I5 with stream gaps declared.

Acceptance seeds: handles close in `_destroy` (lifting unit 2's free-at-GC residual); exceljs streaming writer, unzipper `Open` + `Parse`, ws permessage-deflate give
the oracle's bytes on every host.

Probe facts: those consumers are byte-identical under Node's own `lib/zlib.js` on the engine
(`results/consumers.txt`).

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); re-cut 2026-11-24 after the external review's B1.
