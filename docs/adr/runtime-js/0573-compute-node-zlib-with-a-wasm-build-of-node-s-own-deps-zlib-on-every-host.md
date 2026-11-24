# ADR 0573: Compute node:zlib with a wasm build of Node's own deps/zlib on every host

Status: Proposed (draft — engine choice is the manager's, goal `node-zlib-on-every-host`)
Date: 2026-11

> TL;DR: one wasm build of Node v24.16.0's `deps/zlib` (Chromium's zlib 1.3.1 fork, no SIMD), vendored
> with its build script and sha256, computes every deflate-family member of `node:zlib` on every host,
> under a port of Node's own handle (`node_zlib.cc` ZlibContext) and `lib/zlib.js`; web
> `CompressionStream` leaves zlib. Brotli and zstd stay loud.

## Context

`node:zlib` today: async one-shots and `createGzip` over web `CompressionStream` (ADR-0159, ADR-0178);
every `*Sync`, the other streams, `unzip`, `crc32`, `flush`/`windowBits`/`dictionary` loud on every host;
in the isolate guest every compressing member loud (ADR-0557 §6, no `CompressionStream` there).
ADR-0159 correction 2026-11-18: a sync JS/WASM engine computes the result; choice open. ADR-0557 §6
(2026-11-24) left the engine to the user; the user, on the fork «pako / wasm-сборка zlib из Node /
мост к хосту», answered «исследуй и запускай» — delegating it: the choice is the manager's on these
facts.

Probe `docs/backlog/runtime-js/reference/zlib-engine-probe/` (live Node v24.16.0, zlib `1.3.1-e00f703`;
numbers there). Method: every engine runs under one engine-independent port of Node's handle; Node's
own `lib/zlib.js` also runs on each engine via a swapped `binding.Zlib`.

- Behaviour: wasm build 1418/1418 matrix cases; Node's own `test-zlib*.js` 62/62, of which the 47
  deflate-family files ran on the engine (brotli, zstd and `binding.crc32` stayed native); exceljs
  streaming writer / unzipper / ws permessage-deflate / pngjs sync / pdfkit 5/5 byte-identical; its
  `crc32` 32/32. pako 3.0.3: identical bytes and errors everywhere except `params()` (no
  `deflateParams`) and `crc32` (not exported): 1381/1418, suite 60/62; a rifty port of zlib's
  `deflateParams` over pako's private state closes `params()` (62/62). pako 2.2.0: 1413/1418 (only
  `params()`). pako 1.0.11: 1199/1418 (older hash, other bytes). fflate, wasm-flate, zlib-wasm, libdeflate-wasm:
  no z_stream API; fflate drops the 2nd gzip member, 2/300 corrupt-input texts match.
- Node is not byte-stable across platforms in one place: the gzip header OS byte (19 macOS, 10 Windows,
  3 elsewhere). Every other byte is CPU-independent by source.
- Speed (deflate / inflate 50 MiB, ms): Node 1257 / 77; wasm 1543 / 138 (isolate 1551 / 141, Chromium
  worker 1512 / 141); pako 2440 / 308 (isolate 2379 / 304, worker 2474 / 307).
- First use: isolate 1.4 ms incl. sync compile 0.16 ms (pako 1.6 ms load + 2.9 ms); worker 0.5 ms
  (pako 2.5 ms). A compiled module crosses isolates (`ExternalCopy`).
- Bundles, inline base64: client generic +86 KB min / +37 KB gzip (279.8 → 316.7 KB of a 332 KB cap),
  toolchain +37 KB gzip (323.6 → 360.5 of 386); guest +37 KB gzip. pako: +14 KB gzip client,
  +21 KB guest.
- Memory: 200 streams 38 MiB linear memory, kept after close (reused, never shrunk), outside the isolate
  `memoryLimit` — the class ADR-0563 already settles (memory outside the heap → the worker's RSS
  ceiling; a guest can allocate wasm memory itself today). pako 33 MiB JS heap, collected, counted.

## Decision

1. Engine: `zlib.wasm` built from Node v24.16.0 `deps/zlib` — `adler32 crc32 deflate inflate inftrees
   inffast trees zutil cpu_features`, `-DCPU_NO_SIMD` (Node's own non-SIMD branch of `zlib.gyp`),
   wasm32 reactor, zero imports, exports the z_stream primitives + `malloc`/`free`. Vendored binary +
   build script + sha256; rebuilt when rifty's claimed Node version moves. Licenses: Zlib + Chromium
   BSD-3, credited as Node does.
2. Placement: runtime-js, shared by every host (browser realms and the isolate guest bundle). Inline
   bytes, compiled synchronously on first `node:zlib` use, one instance per realm; no preload gate
   (ADR-0351/0352 machinery not needed: sync compile works in the isolate, a Chromium worker and
   Chromium 148's main thread). Chromium 108's main thread refuses > 4 KB — same owner as
   `runtime-js/chromium108-sdk-sync-wasm-import`.
3. Above it, Node's shape: a port of `node_zlib.cc` ZlibContext as a handle (`init`/`write`/
   `writeSync`/`params`/`reset`/`close`, `_writeState`, `onerror`) and of `lib/zlib.js` (classes as
   callable legacy constructors, one-shots, `create*`, `crc32`, all options incl. `info`,
   `maxOutputLength`, `rejectGarbageAfterEnd`). Consumers that read internals (pngjs: `_handle`,
   `_outBuffer`, `_processChunk`) get Node's.
4. Async forms run the same engine off the caller's turn, as Node's thread pool: `CompressionStream`
   no longer backs `node:zlib` (supersedes ADR-0159 §Decision 1, ADR-0178).
5. Gzip OS byte 3 (zlib's default outside its platform table; rifty's `process.platform` is in none).
6. Each handle frees its zlib state on `close`/end/error, and — as Node's weak handle does on GC — through
   a `FinalizationRegistry` when a stream is dropped without either (rifty's `Transform` runs no
   `_destroy` yet: `runtime-js/stream-destroy-construct-hooks`). Proof: a fault test that drops open
   streams and sees the allocator reuse their blocks. Linear memory itself never shrinks: a realm keeps
   its peak until it ends.
7. Boundary: brotli and zstd stay `NotImplementedError` on every host.

## Alternatives

- pako 3.0.3 (+ a rifty `deflateParams` port): same measured behaviour, 14 KB gzip instead of 37 KB,
  GC'd memory counted by the isolate limit. Not chosen: `params()` needs zlib code written into rifty
  over pako's private fields (a semantic copy pinned to one pako version, ADR + differential suite
  for life) and a `crc32` of rifty's; equivalence is a third party's port tracking Chromium's fork
  (1.0.11 differs; 2.2.0, published to npm 2026-06-22, is the first that matches); 1.6× slower
  deflate, 2.2× slower inflate. Chosen only if the bundle budget, not fidelity, decides.
- pako 1.0.11 (in the lockfile): 219 of 1418 cases differ (bytes at most levels, gunzip `windowBits: 0`).
- fflate / wasm-flate / zlib-wasm / libdeflate-wasm: no z_stream API (no `params`/`reset`/`windowBits`
  /`Z_FULL_FLUSH`/`Z_BLOCK`/dictionary on streams); fflate 9/28 raw bytes, 2nd gzip member dropped.
- Host bridge (isolate only): ~0.02 ms per crossing, real Node bytes, but browser hosts still need an
  engine (two engines, bytes follow the embedder's Node), adds a host capability against ADR-0557 §6,
  and a 0.5 MB bomb grew host RSS by 967 MiB past a 64 MiB guest limit.
- Keep `CompressionStream` for async: ignores `level`/`windowBits`/`dictionary`; Chromium 148 rejects
  a trailing LF and a 2nd gzip member (probe `results/bench-browser.txt`).
- Wasm as a host-published asset (ADR-0352-style): −37 KB gzip from bundles at the price of an async
  preload gate and a fetched asset per boot; not measured, not needed while bundles fit.

## Consequences

- (+) One engine, one byte stream on every host, by construction Node's; zlib updates follow Node's.
- (+) The rest of the goal is a port of Node's own JS/C++ logic, testable against Node's own suite.
- (−) +37 KB gzip in client bundles (15 KB left under the generic cap); a vendored binary and a pinned
  clang/wasi-libc/binaryen toolchain; manual free of zlib state; linear memory never shrinks.
- Follow-ups: goal `node-zlib-on-every-host` (map); compat `zlib.md`, isolate-host rows; ADR-0159 and
  ADR-0178 marked superseded when the unit lands.
