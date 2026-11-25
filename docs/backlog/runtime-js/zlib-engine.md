---
area: runtime-js
status: ready
title: The wasm build of Node's deps/zlib and a port of Node's zlib handle land in runtime-js, proven against Node, and give zlib.crc32 on every host
created: 2026-11-24
why: The engine and the handle are the only parts of node:zlib that stand on nothing in rifty's streams; landing and proving them first leaves lib/zlib.js one port away, and crc32 is the one guest-visible call they carry
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md, docs/backlog/runtime-js/zlib-crc32.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts]
---

## Context

Unit 2 of the goal (manager 2026-11-24, after round 2 of the external review of PR #448): Node's zlib
classes are `Transform` subclasses and all their observable state is `Transform`'s, so `lib/zlib.js`
comes to rifty only on a `Transform` that equals Node's on those paths (unit 3,
`runtime-js/zlib-node-lib-port`). What does not stand on streams lands here: ADR-0573's engine, a port
of `node_zlib.cc` ZlibContext as Node's handle (`init`/`write`/`writeSync`/`params`/`reset`/`close`,
`_writeState`, `onerror`), and `zlib.crc32` — the only guest-visible change. Classes, `*Sync`,
`create*`, the callback forms and today's browser `Gzip` stay exactly as on main.

The handle is proven without rifty's `Transform`: at binding level by the probe's matrix (1420 cases,
`results/cases.txt`), and under Node's own `lib/zlib.js` in a Node-hosted harness (probe
`swap-binding.cjs` → Node's `test-zlib*.js` 62/62, `results/node-suite.txt`; `zlib-diff.mjs` column
`port/N` = real Node 16/16, `results/zlib-diff.txt`). Until unit 3 the handle is imported only by its
tests: no bundle carries it.

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge) and both external review rounds of PR #448; re-cut after round 2's R2-B1/R2-B2

## Acceptance

1. `zlib.crc32(data[, value])` gives Node's values for strings and every `ArrayBufferView`, and
   Node's argument errors (`ERR_INVALID_ARG_TYPE` for `data`, `ERR_OUT_OF_RANGE`/`ERR_INVALID_ARG_TYPE`
   for `value`), `crc32.length` 1, on the browser hosts and in the isolate guest, computed by the
   engine (closes `runtime-js/zlib-crc32`) → I1
2. Carrier step 7a (`crc32`) turns green on every host; every other carrier case keeps its pinned
   outcome unchanged → scenario, I1
3. The handle reproduces Node's binding on the probe matrix (1420 cases) as a runtime-js unit test
   against live `node:zlib` → I2, I3
4. Node v24.16.0's own `lib/zlib.js` (verbatim from the pinned tarball, as `zlib-diff.mjs` loads it)
   runs over the handle with Node's `stream.Transform` in a Node-hosted test: the 47 deflate-family
   `test-zlib*.js` pass and the differential's `port/N` column equals real Node on every scenario →
   I1, I3, I4
5. The engine is compiled on the first call that needs it, never when the builtins load: a per-PR test
   on current Chromium instruments `WebAssembly.Module`/`Instance`/`compile`/`instantiate` and fails if
   importing the builtins creates any; a Chromium 108 floor-lane run (manual, `browser-floor.yml` is
   dispatch-only) recorded once in this unit's PR body → ADR-0573
6. Every engine pointer is checked: a failed allocation is a loud error, with a test that exhausts the
   wasm memory → ADR-0573
7. `zlib.wasm` is rebuilt on the Linux CI runner from the sha256-pinned Node tarball by a pinned
   toolchain (release + digest) and matches the committed sha256; the binary (Zlib + Chromium BSD-3)
   and the ported Node code (MIT) are in the licence record (`vendor/`/`generated/` manifest of PR #445)
   → ADR-0573
8. Measured before wiring: whether the builtin `zlib` module (engine included) can leave the client
   generic eager graph without changing `require('zlib')`'s synchronous semantics; with or without it,
   `pnpm test:client-bundles` stays under every cap, cause and numbers in `client-bundle-budget.mjs`'s
   note → ADR-0573
9. Unchanged on every host, their existing conformance, parity and isolate rows green and unmodified:
   classes, `*Sync`, `create*`, callback one-shots, `util.promisify` forms, `Gzip`/`createGzip`
   (browser `CompressionStream`), the isolate's `isolate-host.zlib.<member>` gaps other than `crc32`
   → ADR-0573
10. compat `zlib.md` and `isolate-host.md`: `crc32` ✅ on every host; nothing else changes → I1

## Parity cases

Oracle: Node v24.16.0, live.

1. `crc32` of `''`, `'hello'`, a 64 KiB text, 100 KB zeros, 16 KiB random, as string, `Buffer`,
   `Uint8Array`, `Uint16Array`, `DataView`, × `value` 0, 1, 0xffffffff, 0x12345678 → I1
2. `crc32` argument errors: `data` number / object / undefined; `value` −1, 2 ** 32, 1.5, `'1'` → I1
3. Matrix groups at binding level (probe `cases.mjs`): compressed bytes per format × level × input;
   strategy / memLevel / windowBits 8–15 / chunkSize; flush sequences, `params`, `reset`, dictionary;
   inflate tails, truncation, corruption, 900 fuzz, gzip members, `windowBits` 0, unzip sniff,
   wrong format, dictionary errors → I2, I3

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| wasm compile/instantiate fails on first `crc32` | `crc32` throws a named error; no fallback | unit test with a corrupt module | → ADR-0573 |
| zlib's own allocation fails (realm wasm space exhausted) | the handle reports Node's `Zlib error` `Z_MEM_ERROR` | handle test opening states until 4 GiB | → ADR-0573 |
| the port's buffer allocation fails | loud `RangeError`, never a write at address 0 | Acceptance 6 | → ADR-0573 |

## Out of scope

- Classes, `*Sync`, `create*`, callback one-shots, `info`, `_processChunk` (pngjs) — Node's
  `lib/zlib.js` on rifty: `runtime-js/zlib-node-lib-port` (unit 3), after the streams goal's core.
- Streams under load (backpressure, destroy mid-write, event order): `runtime-js/zlib-streams-under-load`.
- Brotli and zstd: `NotImplementedError` on every host, compat ❌ (manager's scoping, user confirmation
  pending).
- Node's output on Windows (no lane; goal Decisions); Firefox/WebKit lanes (ADR-0469, dispatched).
- The SDK page's own main-thread import on Chromium 108 (`runtime-js/chromium108-sdk-sync-wasm-import`).

## Decisions

- 2026-11-24 — manager: one chokepoint, dependency order — `lib/zlib.js` only on a `Transform` equal to Node's; this unit carries the engine, the handle and `crc32`.
- 2026-11-24 — manager: Chromium 108 acceptance is a per-PR instrumentation test on current Chromium plus a manual floor-lane run in the PR body; the dispatch-only lane does not close acceptance.
- The handle stays out of every bundle until unit 3 imports it (Simplicity: no shipped code without a caller); the engine ships for `crc32`.
- Engine and placement per ADR-0573 (inline, lazy, one instance per realm).
