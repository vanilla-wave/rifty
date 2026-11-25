# ADR 0573: Compute node:zlib with a wasm build of Node's own deps/zlib on every host

Status: Accepted — manager decision 2026-11-24 by the user's delegation («исследуй и запускай»), not the user's choice
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

- Behaviour: wasm build 1420/1420 matrix cases — the byte-level proof (compressed bytes per option and
  flush sequence, inflate edges, 900 corrupt inputs, `crc32`). Node's own `test-zlib*.js` 62/62 through
  a swapped handle: 36 of its 47 deflate-family files write through the engine (8 open a handle and
  never write, 3 open none; brotli, zstd and `binding.crc32` stay native); those tests are mostly
  round trips (pako 1.0.11 passes 59/62 with 221 matrix differences), so they prove the API shape, not
  bytes. exceljs streaming writer / unzipper / ws permessage-deflate / pngjs sync / pdfkit 5/5
  byte-identical under Node's own `lib/zlib.js`. pako 3.0.3: identical bytes and errors everywhere
  except `params()` (no `deflateParams`) and `crc32` (not exported): 1383/1420, suite 60/62; a rifty
  port of zlib's `deflateParams` over pako's private state closes `params()`. pako 2.2.0: 1415/1420
  (only `params()`). pako 1.0.11: 1199/1420. fflate, wasm-flate, zlib-wasm, libdeflate-wasm: no
  z_stream API; fflate drops the 2nd gzip member, 2/300 corrupt-input texts match.
- Node is not byte-stable across platforms in one place: the gzip header OS byte (19 macOS, 10 Windows,
  3 elsewhere). Every other byte is CPU-independent by source; only macOS arm64 Node was run.
- Speed (deflate / inflate 50 MiB, ms): Node 1257 / 77; wasm 1543 / 138 (isolate 1551 / 141, Chromium
  148 worker 1559 / 143); pako 2440 / 308 (isolate 2379 / 304, worker 2521 / 326).
- First use: isolate 1.4 ms incl. sync compile 0.16 ms (pako 1.6 ms load + 2.9 ms); Chromium 148 worker
  0.5 ms (pako 2.6 ms); Chromium 108 worker 1.6 ms. A compiled module crosses isolates (`ExternalCopy`).
- Chromium 108 (ADR-0469's supported floor), `results/chromium108.txt`: in a Worker, sync
  `new WebAssembly.Module` of the 64 KB build, instantiation and a 1 MiB round trip work; on the page
  main thread both sync `new WebAssembly.Module` and sync `new WebAssembly.Instance` (even of an
  asynchronously compiled module) are refused above 4 KB. Guest code runs in a Worker on every browser
  host; the SDK page only imports the builtins (their module top level runs there — how the lexer's
  `initSync` broke 108, `runtime-js/chromium108-sdk-sync-wasm-import`).
- Bundles, inline base64, engine only: client generic +86 KB min / +37 KB gzip (279.8 → 316.7 KB of a
  332 KB cap), toolchain +37 KB gzip (323.6 → 360.5 of 386); guest +37 KB gzip. pako: +14 KB gzip
  client, +21 KB guest. Not counted: the ported handle + `lib/zlib.js` (≈ 8.5 KB gzip unminified) minus
  today's `zlib.ts`.
- Memory: 200 streams 38 MiB linear memory, kept after close (reused, never shrunk), outside the isolate
  `memoryLimit`. Not a new guest capability (probe `guest-wasm.mjs`, `runCode({ memoryLimitMb: 64 })`,
  allocation held 500 ms so the pool's 25 ms RSS sampler sees it): a guest already fills its own
  128 MiB `WebAssembly.Memory`, exit 0 (3/3); 512 MiB ends `termination: 'memory'` (3/3). The class is
  ADR-0563's (memory outside the heap → the worker's RSS ceiling, 256 MiB + 3 × the calls' limits,
  `protocol.ts` `rssCeilingBytes`). pako 33 MiB JS heap, collected, counted.
- Per-stream state (probe `streams-cap.mjs`, in a Node process): an open deflate stream 302776 B of
  linear memory (450232 B at `memLevel: 9`), an inflate stream 58327 B. Per host:
  - Node process (and so any realm without a lower ceiling): 10000 deflate = 2888 MiB; the 4 GiB
    wasm32 space ends at 14182 (9538 at `memLevel: 9`) — the next stream's first write errors
    `Zlib error` `Z_MEM_ERROR` through Node's error path. Real Node: 10000 open, RSS +2201 MiB.
  - Isolate host: the worker RSS ceiling comes first — computed ≈ 1400 deflate streams at
    `memoryLimitMb: 64` (448 MiB ceiling), ≈ 3000 at 256; outcome `termination: 'memory'` (or a rerun of
    the neighbours, ADR-0563 §6). Computed, not run with the engine.
  - Chromium: not measured (its per-tab wasm memory limit is unknown here).
- Node's own `lib/zlib.js`, loaded verbatim from the pinned tarball over the probe handle
  (`zlib-diff.mjs`; that file equals the binary's builtin source): over Node's `Transform` it equals
  real `node:zlib` in the state group 45/45 and the load group 1/1 (its one stable field, the `'drain'` count); over rifty's `Transform` (main) the state group (45 paths I1–I4
  promise) differs in 26, 154 fields, the load group in 1/1 — `Symbol.asyncDispose`, constructor option
  validation (`highWaterMark`, `signal`), `_destroy` never running (so the handle never closes), no
  `autoDestroy` after `'end'`, no `errored`/`closed`/`readableFlowing`, `finished` on a closed stream,
  `write(chunk, '', cb)` refused (every `flush()` kind and `params()`), `'end'`/`'finish'` order, one
  extra `'drain'` under load. All are rifty's streams, none the engine's.

## Decision

1. Engine: `zlib.wasm` built from Node v24.16.0 `deps/zlib` — `adler32 crc32 deflate inflate inftrees
   inffast trees zutil cpu_features`, `-DCPU_NO_SIMD` (Node's own non-SIMD branch of `zlib.gyp`),
   wasm32 reactor, zero imports, exports the z_stream primitives + `malloc`/`free`. Vendored binary +
   build script + sha256, rebuilt when rifty's claimed Node version moves. The probe's toolchain is
   not pinned (whatever Homebrew has); a pinned toolchain, a Linux CI rebuild that matches the
   committed sha256, and the licence record (Zlib + Chromium BSD-3, the ported Node code MIT, via the
   `vendor/`/`generated/` manifest of PR #445) are unit 2's acceptance.
2. Placement: runtime-js, shared by every host (browser Workers and the isolate guest bundle). The engine
   and the handle enter the bundles in unit 3, with `lib/zlib.js` and `crc32` (manager 2026-11-24,
   round 3: shipping the engine earlier for `crc32` alone would put ≈ 24 KB gzip of deflate/inflate
   without a caller into every bundle against ≈ 15 KB of generic headroom — §Simplicity); unit 2 builds
   and proves them unbundled, and its merge is held until unit 3 can follow. Inline
   bytes (base64), compiled synchronously on the first `node:zlib` call that needs the engine, never at
   module load (the SDK page imports the builtins on the main thread, where Chromium 108 refuses sync
   compile and sync instantiation > 4 KB); one instance per realm; no preload gate. Every pointer the
   engine returns is checked: a null `malloc` is a loud failure, not a write at address 0.
3. Above it, Node's shape: a port of `node_zlib.cc` ZlibContext as a handle (`init`/`write`/
   `writeSync`/`params`/`reset`/`close`, `_writeState`, `onerror`; unit 2, proven against Node without
   rifty's `Transform`) and Node's `lib/zlib.js` (unit 3, only on a `Transform` that equals Node's on
   every zlib path — entry criterion: `zlib-diff.mjs`'s state group with 0 differences; exit: the
   same scenarios against product `node:zlib` in the isolate and in Chromium) (classes as
   callable legacy constructors, one-shots, `create*`, `crc32`, all options incl. `info`,
   `maxOutputLength`, `rejectGarbageAfterEnd`). Consumers that read internals (pngjs: `_handle`,
   `_outBuffer`, `_processChunk`) get Node's.
4. Async forms run the same engine on the caller's thread in a later turn — not a thread pool: a large
   async call blocks that realm's event loop for its duration (Node's does not). Declared, compat ⚠️.
   `CompressionStream` stops backing `node:zlib` in unit 3, in one step with the rest of `lib/zlib.js`
   (supersedes ADR-0159 §Decision 1 and ADR-0178 then); no state with two engines.
5. Gzip OS byte 3 (zlib's default outside its platform table; rifty's `process.platform` is in none).
6. Each handle frees its zlib state on `close` (`_destroy` → `_close`, Node's path), and — as Node's
   `MakeWeak` does — through a `FinalizationRegistry` when an object is dropped without closing.
   Proof: a GC-lane test (`--expose-gc`) that drops open streams and sees the allocator reuse their
   blocks — unit 3. Linear memory itself never shrinks: a realm keeps its peak until it ends.
7. Boundary: brotli and zstd stay `NotImplementedError` on every host (manager's scoping, user
   confirmation pending).
8. Bundle budget: engine only, inline costs +36950 B gzip in the client generic bundle (279754 →
   316704 of 332000: 15296 B left before the port of the handle and `lib/zlib.js`, minus today's
   `zlib.ts`) and +36855 B in toolchain (25530 B left). Kill condition: a PR that would cross a
   `CLIENT_BUNDLE_BUDGETS` cap re-opens this placement — in order: the builtin `zlib` module (engine
   included) as a lazily loaded chunk, if one can exist without changing `require('zlib')`'s
   synchronous semantics (it may not); the wasm as a host-published asset with a pre-entry preload
   (ADR-0351/0352; in browser Workers both `installNodeRuntime` and `worker-entry.ts`'s boot would
   need it); pako (Alternatives). None of the three is measured; unit 3 measures the first before
   wiring the engine.

## Alternatives

- pako 3.0.3 (+ a rifty `deflateParams` port): same measured behaviour, 14 KB gzip instead of 37 KB,
  GC'd memory counted by the isolate limit, no wasm on Chromium 108's main thread. Not chosen:
  `params()` needs zlib code written into rifty over pako's private fields (a semantic copy pinned to
  one pako version, ADR + differential suite for life) and a `crc32` of rifty's; equivalence is a
  third party's port tracking Chromium's fork (1.0.11 differs; 2.2.0, published to npm 2026-06-22, is
  the first that matches); 1.6× slower deflate, 2.2× slower inflate. Chosen only if the bundle budget,
  not fidelity, decides.
- pako 1.0.11 (in the lockfile): 221 of 1420 cases differ (bytes at most levels, gunzip `windowBits: 0`).
- fflate / wasm-flate / zlib-wasm / libdeflate-wasm: no z_stream API (no `params`/`reset`/`windowBits`
  /`Z_FULL_FLUSH`/`Z_BLOCK`/dictionary on streams); fflate 9/28 raw bytes, 2nd gzip member dropped.
- Host bridge (isolate only): ~0.02 ms per crossing, real Node bytes, but browser hosts still need an
  engine (two engines, bytes follow the embedder's Node), adds a host capability against ADR-0557 §6,
  and a 0.5 MB bomb grew host RSS by 967 MiB past a 64 MiB guest limit.
- Keep `CompressionStream` for async for good: ignores `level`/`windowBits`/`dictionary`; Chromium 148
  rejects a trailing LF and a 2nd gzip member (probe `results/bench-browser.txt`).
- Wasm as a host-published asset (ADR-0352-style): −37 KB gzip from bundles at the price of an async
  preload in two boot paths and a fetched asset per boot; not measured, not needed while bundles fit.

## Consequences

- (+) One engine, one byte stream on every host, by construction Node's; zlib updates follow Node's.
- (+) The rest of the goal is a port of Node's own JS/C++ logic, testable against Node's own suite.
- (−) +37 KB gzip in client bundles for the engine alone (15 KB left under the generic cap before the
  port); a vendored binary whose toolchain unit 2 pins; manual free of zlib state; linear memory never
  shrinks; async calls block the realm's loop.
- (−) Order: everything guest-visible in `node:zlib`, `crc32` included, waits for the streams goal's
  core (map); until then main's behaviour stays per host. Units 2 and 3 merge back to back.
- Follow-ups: goal `node-zlib-on-every-host` (map); compat `zlib.md`, isolate-host rows; ADR-0159 and
  ADR-0178 marked superseded when unit 3 lands.
