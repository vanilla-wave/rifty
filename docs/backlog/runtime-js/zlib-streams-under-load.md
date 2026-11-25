---
area: runtime-js
status: draft
title: node:zlib's streams behave as Node's under load — backpressure, destroy mid-write, event order — on every host
created: 2026-11-24
why: exceljs, unzipper and ws pipe large data through zlib streams; Node's processCallback defers writes on a full readable buffer and its event order is part of what they observe
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/transform-readable-backpressure.md, docs/backlog/runtime-js/duplex-end-finish-close-order.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/io/src/streams/transform.ts]
---

## Context

Unit 4 of the goal, after the streams goal's part on `Transform` backpressure and after unit 3. Node's
`processCallback` swaps `_read` to defer the next engine write when `push` returns false; destroying a
zlib stream mid-write stops the engine and frees the handle; `'finish'`/`'end'`/`'close'` order.
Walls (compat `streams.md`): `runtime-js/transform-readable-backpressure`,
`runtime-js/duplex-end-finish-close-order`. Not measured here: these over zlib classes (the
differential of unit 3 covers state, not load). Flips the exceljs "named gap" row in
`library-exceljs.test.ts` if unit 3 does not.

Acceptance seeds: exceljs streaming writer, unzipper `Open` + `Parse`, ws permessage-deflate give the
oracle's bytes on every host under inputs that fill the readable buffer; the probe's consumers are
byte-identical under Node's own `lib/zlib.js` on the engine (`results/consumers.txt`).

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); re-cut after round 2 of the external review of PR #448
