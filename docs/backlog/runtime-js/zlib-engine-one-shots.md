---
area: runtime-js
status: draft
title: One zlib engine under a port of Node's handle computes every one-shot, sync form, unzip and crc32 on every host
created: 2026-11-24
why: The sync forms, unzip, crc32, the options and Node's error/trailing-byte semantics need a real engine; CompressionStream cannot give them and the isolate has none
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md, docs/backlog/runtime-js/zlib-trailing-bytes-after-stream-end.md, docs/backlog/runtime-js/zlib-crc32.md, docs/backlog/runtime-js/zlib-web-compression-subset.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts]
---

## Context

Unit 2 of the goal. Engine per ADR-0573 (draft; the manager's choice). Shape the probe proved
(`driver.mjs` + `swap-binding.cjs`): a port of `node_zlib.cc` ZlibContext as Node's handle
(`init`/`write`/`writeSync`/`params`/`reset`/`close`, `_writeState`, `onerror`) over the engine's
z_stream primitives, and of `lib/zlib.js`'s one-shot path (`zlibBuffer`, `zlibBufferSync`,
`processChunkSync`, validation, `info`, `maxOutputLength`). Async forms run the engine off the
caller's turn; web `CompressionStream` leaves `node:zlib`.

Covers: the 7 one-shots (callback, `util.promisify`), the 7 `*Sync`, `unzip`/`unzipSync`, `crc32`, on
browser hosts and in the isolate guest (its `ceiling-zlib.ts` members become the shared
implementation). Closes `zlib-trailing-bytes-after-stream-end` (tails, zero padding, members — the
engine's), `zlib-crc32`, and the one-shot rows of `zlib-web-compression-subset`.

Probe facts on the wasm build through this shape: 1418/1418 matrix (incl. `crc32` 32/32); Node's own
47 deflate-family `test-zlib*.js` files pass (its `crc32` test ran on Node's native `binding.crc32`);
pdfkit and pngjs `PNG.sync.write` byte-identical.

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); findings 3, 5, 6, 12 touched these drafts and are fixed.
