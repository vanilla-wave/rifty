---
area: runtime-js
status: draft
title: node:zlib brotli and zstd members are loud NotImplementedError on every host; Node v24.16.0 has both
created: 2026-11-25
why: Deferred out of goal node-zlib-on-every-host by the manager's decision (the user delegated it); recorded so the gap stays explicit, with today's per-host outcome and what delivering it would take
sources: [docs/backlog/runtime-js/reference/zlib-brotli-zstd-probe/results/z1-brotli-zstd.txt, docs/backlog/epics/node-zlib-on-every-host/goal.md, docs/public/compat/zlib.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts]
---

## Context

Goal `node-zlib-on-every-host` delivers the deflate family (and `crc32`). Brotli and zstd are outside
it: deferred by the manager's decision (the user delegated it) — answered, recorded by the manager.
Ground: no carrier case and none of the goal's libraries (exceljs, unzipper, pdfkit, pngjs, ws, with
their installed dependency trees) calls them, and Node builds them from separate C libraries
(`deps/brotli`, `deps/zstd`), so each would add its own engine and bundle growth.

Today (`reference/zlib-brotli-zstd-probe/results/z1-brotli-zstd.txt`, one program,
`programs/z1-brotli-zstd.cjs`, run through the streams probe's `run.mjs` with `PROGRAMS=`; rifty
`d15f0af1a`, Node v24.16.0):
- the probed members — `brotliCompressSync`, `brotliCompress`, `createBrotliCompress`,
  `createBrotliDecompress`, `new BrotliCompress()`, and the same five for zstd — throw
  `NotImplementedError` in rifty's browser-host modules (in-process, with and without the async VFS
  surface) and in the isolate host. The decompress rows stop at their inner `*CompressSync` call;
  the members not probed (`brotliDecompress*`, `BrotliDecompress`, the zstd ones) throw too by code
  (`packages/runtime-js/src/builtins/zlib.ts:385-394`, `:423-425`;
  `packages/isolate-guest/src/guest/ceiling-zlib.ts:23-39`, `:80-90`);
- the callback forms throw synchronously where Node calls back — by code (`zlib.ts:55-59` `notImpl`
  throws at the call); the probe prints both cases alike;
- `constants.BROTLI_PARAM_QUALITY` and `constants.ZSTD_c_compressionLevel` equal Node's (2 of 14 rows);
- compat ❌ rows: `docs/public/compat/zlib.md` (Brotli, Zstd).

Chromium (Workbench, SDK) was not run: the in-process column runs the same `runtime-js` module the
browser hosts load.

Likely route, not decided (no ADR chooses an engine for them; ADR-0573 §7 only draws the boundary):
Node's `deps/brotli` and `deps/zstd` built to wasm by the same pipeline as `runtime-js/zlib-engine`,
for Node's bytes, Node's own handles for them, and `lib/zlib.js`'s brotli/zstd classes over them once
zlib unit 3 has ported `lib/zlib.js`. Size: not measured.

Consumers: none in the zlib carrier. `pdfkit` 0.17.2 → `fontkit` 2.0.4 decodes WOFF2 through the
pure-JS `brotli` 1.3.3 package, not `node:zlib`. Other consumers (e.g. HTTP clients decoding
`content-encoding: br` or `zstd`) are not verified here.

## Challenge

challenge: 2026-11-25 — none (factual capture of a deferred scope)
