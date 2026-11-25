# zlib engine probe (2026-11-24)

Which engine computes rifty's `node:zlib` on every host. Measured against live Node v24.16.0
(zlib `1.3.1-e00f703`, Chromium fork), macOS arm64 M3 Pro, isolated-vm 7.0.2, Chromium 148.0.7778.96
(`@playwright/test` 1.60.0) and Chromium 108.0.5359.29 (the floor lane's pinned runner).
Decision: ADR-0573 (Accepted, the manager's). Goal: `docs/backlog/epics/node-zlib-on-every-host/`.

## Run

```sh
sh run-all.sh /tmp/zep-deps /tmp/zep-build    # two empty dirs outside the repo; writes results/*.txt
```

Downloads (npm tarballs, Node source) are sha256-pinned in `fetch.sh` and land only in `DEPS`;
scripts stay here. The wasm toolchain is **not pinned**: whatever Homebrew `llvm lld wasi-libc
wasi-runtimes binaryen` are installed (this run: llvm 23.1.6, wasi-libc 34, binaryen 133).
`measure-bundles.sh` edits `runtime-js/src/builtins/zlib.ts` for one build and restores it on exit —
run it on a clean tree. `chromium108.mjs` needs the floor lane's runner (`tools/floor-lane/run.mjs`
recipe: `playwright@1.28.1`, `install chromium` under Node 18.20.8); `run-all.sh` does not run it.

| Script | Measures |
|---|---|
| `driver.mjs` | Node's handle semantics, engine-independent: port of `node_zlib.cc` ZlibContext (init, dictionary, gzip members, unzip sniff, error mapping, params, reset) + `lib/zlib.js` `processChunkSync` |
| `engines.mjs` | z_stream adapters: pako 1/2/3, `pako@3.0.3+params` (zlib 1.3.1 `deflateParams` ported over pako's private state), the wasm build (every pointer checked) |
| `handle.cjs` | Node's native handle shape (`init`/`write`/`writeSync`/`params`/`reset`/`close`) over `driver.mjs` |
| `cases.mjs` | 1420 cases, Node oracle vs each engine through `driver.mjs` — the byte-level proof |
| `swap-binding.cjs` | preload: Node's native `binding.Zlib` → `handle.cjs`, so Node's **own** `lib/zlib.js` runs on an engine |
| `node-suite.mjs` | Node's own `test/parallel/test-zlib*.js` (62) natively and per engine through the swap |
| `consumers.mjs` + `consumer-scenarios.cjs` | exceljs streaming writer, unzipper, ws permessage-deflate, pngjs sync, pdfkit — digest of their output, native vs engine; a run counts only with exit 0, no signal, one JSON line |
| `zlib-diff.mjs` | Node's own `lib/zlib.js` loaded verbatim from the pinned tarball (`--expose-internals`) over the probe handle, with Node's vs rifty's `Transform` (main): 16 scenarios of state and behaviour |
| `browser-pins.mjs` | each carrier case's first zlib call on main: rifty's browser-host `zlib.ts` in a Chromium 148 Worker, and the isolate host |
| `async-vs-sync.mjs` | engine bytes vs Chromium's `CompressionStream` (today's browser backend) on the same inputs — measured for an intermediate state the goal then dropped (map: no state with two engines) |
| `highlevel.mjs` | controls without a z_stream API: fflate, wasm-flate |
| `bench-*.mjs`, `bench-core.js`, `memory.mjs` | speed (Node, isolate, Chromium 148 worker), first use, memory, host bridge |
| `chromium108.mjs` | Chromium 108: sync compile/instantiate on the main thread and in a Worker, round trip |
| `streams-cap.mjs` | wasm bytes per open stream; streams one realm opens before the wasm32 4 GiB space ends; 10000 native streams |
| `guest-wasm.mjs` | one-off (imports `packages/isolate-host/src`, no gate runs it): does a `runCode` guest already hold wasm memory beyond its `memoryLimit` |
| `measure-bundles.sh` | real bundle cost: `pnpm test:client-bundles` + isolate guest build per engine |
| `main-red.mjs` | the same calls on main: real Node vs rifty isolate host vs rifty's browser-host module |

## Results

### Behaviour (`results/cases.txt`, `node-suite.txt`, `consumers.txt`, `highlevel.txt`)

| | pako 1.0.11 | pako 2.2.0 | pako 3.0.3 | pako 3.0.3 + params port | wasm build of Node's deps/zlib | fflate 0.8.3 | wasm-flate |
|---|---|---|---|---|---|---|---|
| 1420-case matrix = Node | 1199 | 1415 | 1383 | 1388 | **1420** | — (no z_stream) | — |
| compressed bytes, 264 level × format × input | 114 | 264 | 264 | 264 | 264 | 9/28 (raw) | 1/7 |
| `params()` (deflateParams) | ✗ absent | ✗ absent | ✗ absent | 5/5 | 5/5 | ✗ | ✗ |
| `crc32(data, value)`, 32 cases | 32 | 32 | not exported | not exported | 32 | — | — |
| inflate edges: tails, members, truncation, corrupt, 900 fuzz, dictionary, windowBits | 1 diff (gunzip `windowBits: 0` → false `Z_DATA_ERROR`) | all | all | all | all | 2 members → 1st only; fuzz same outcome 49/300, same text 2/300 | — |
| Node's own test-zlib*.js, 62 files | 59 | 60 | 60 | **62** | **62** | — | — |
| exceljs / unzipper / ws / pngjs / pdfkit = native bytes | — | — | 5/5 | 5/5 | 5/5 | — | — |

The matrix compares bytes, or error message + class + `code` + `errno`; the gzip OS byte is masked only
at member headers. Node's own suite proves API shape, not bytes: only 36 of its 47 deflate-family files (all `test-zlib*.js` but the 15 with `brotli`/`zstd` in the name, incl. `test-zlib.js`, `test-zlib-crc32.js` — the latter on Node's native `binding.crc32`, proving nothing about rifty's `crc32`)
write through the engine (8 open a handle and never write, 3 open none; brotli, zstd and
`binding.crc32` stay native), and its tests are mostly round trips — pako 1.0.11 passes 59/62 with
221 matrix differences.

Not candidates by API: zlib-wasm 1.0.7 (two base64 one-shot functions, async load, pako fallback);
libdeflate-wasm 1.0.0 (whole-buffer API by design — no stream, flush or dictionary; from its README,
not run); fflate/wasm-flate (above).

Node's own output is **not** platform-stable in one byte: the gzip header OS field (each member) is the
build's `OS_CODE` — 19 macOS, 10 Windows, 3 elsewhere (`deps/zlib/zutil.h`). Not a criterion; every
engine writes 3. All other bytes: no CPU dependence by source (deflate hash is Chromium's fixed
"ANZAC++" multiply, SIMD paths are slide_hash/crc/chunk-copy — output-neutral); x64 Node not run.

### Node's `lib/zlib.js` over rifty's `Transform` (`results/zlib-diff.txt`)

Node v24.16.0's own `lib/zlib.js`, verbatim (the tarball's file equals the binary's builtin source),
over the probe handle; only `stream.Transform`/`finished` and the stream helpers differ between columns
(errors, validators, `Buffer`, timers, `binding.crc32` stay Node's — so this is the entry criterion of
the goal's `lib/zlib.js` unit, not its exit). Values compared whole: bytes by hash (gzip OS byte
normalised), errors by class, `code`, `errno` and full message.

- With Node's `Transform` it equals real `node:zlib`: state group 45/45, load group 1/1. The load group observes only stable fields (`write()` returning false, `'drain'` count, bytes); `readableLength` before reading is timing-dependent in Node itself and is not observed. Three runs give byte-identical output.
- With rifty's `Transform` (main): state group (45 paths I1–I4 promise, incl. guards equal today)
  differs in 26, 154 fields; load group 1/1 (one `'drain'` more). Gaps: `Symbol.asyncDispose`
  missing; constructor option validation (`highWaterMark: -1`, `signal: 1` compress instead of
  throwing); `_destroy` never runs (the handle never closes: after a sync error `reset()` passes and
  the next `_processChunk` throws the previous `Z_DATA_ERROR` again, where Node asserts and throws
  `TypeError …writeSync`); no `autoDestroy` after `'end'`; no `errored`/`closed`/`readableFlowing`;
  `finished` on a closed stream calls back instead of `ERR_STREAM_PREMATURE_CLOSE`; `write(chunk, '',
  cb)` (Node's `flush()`/`params()` marker) refused with `ERR_UNKNOWN_ENCODING`, so every flush kind
  and `params()` lose their effect; `'finish'` before `'end'` where Node orders `'end'` first.

### Cost (`results/bench-*.txt`, `chromium108.txt`, `memory.txt`, `streams-cap.txt`, `guest-wasm.txt`, `bundles.txt`)

| | node:zlib | pako 3.0.3 | wasm build |
|---|---|---|---|
| deflate L6 1 MiB / 50 MiB — Node main realm, ms | 25 / 1257 | 46 / 2440 | 31 / 1543 |
| inflate 1 MiB / 50 MiB — Node, ms | 1.6 / 77 | 5.8 / 308 | 2.7 / 138 |
| deflate / inflate 50 MiB — isolate, ms | — | 2379 / 304 | 1551 / 141 |
| deflate / inflate 50 MiB — Chromium 148 worker, ms | — | 2521 / 326 | 1559 / 143 |
| deflate / inflate 1 MiB — Chromium 108 worker, ms | — | 51.8 / 7.4 | 32.4 / 2.6 |
| first use in a fresh isolate (load + 1 KiB round trip), ms | — | 1.6 load + 2.9 | 1.4 incl. sync compile 0.16 + instantiate 0.09 |
| first use, Chromium worker (148 / 108), ms | — | 2.6 / — | 0.5 / 1.6 |
| sync `new WebAssembly.Module` (64 KB) | — | n/a | ok: isolate, Chromium 148 and 108 Workers, Chromium 148 main thread. Chromium 108 main thread refuses sync compile **and** sync `new WebAssembly.Instance` > 4 KB |
| client bundles generic / toolchain, Δ min / Δ gzip, B (engine only) | baseline 932920/279754, 1061998/323615 (caps 1124000/332000, 1284000/386000) | +44561/+14198, +44626/+13945 | +86372/+36950, +86456/+36855 (inline base64) |
| isolate guest.js Δ raw / Δ gzip, B (unminified bundle) | baseline 7123270/1497917 | +110158/+20573 | +86545/+36857 |
| 100 deflate + 100 inflate streams open → closed | — | 33.4 → 0.2 MiB JS heap (GC'd) | 38 → 38 MiB linear memory (never shrinks; reused on reopen) |
| counted by isolate `memoryLimit` | — | yes (JS ArrayBuffers) | **no**: 512 MiB `memory.grow` under a 64 MiB limit succeeds (bare isolated-vm). A `runCode` guest already fills its own 128 MiB `WebAssembly.Memory` under 64 MiB, exit 0 (3/3); 512 MiB ends `termination: 'memory'` (3/3) — both held 500 ms for the pool's 25 ms RSS sampler |
| open streams | 10000 deflate: RSS +2201 MiB | — | deflate 302776 B each (450232 at `memLevel: 9`), inflate 58327 B. Node process: 10000 deflate = 2888 MiB; the 4 GiB space ends at 14182 (9538 at `memLevel: 9`): next one `Zlib error` `Z_MEM_ERROR`. Isolate: the worker RSS ceiling (256 MiB + 3 × limit) comes first, ≈ 1400 at 64 MiB — computed, not run. Chromium: not measured |
| reproducible build | npm tarball | npm tarball | same sha256 three times on one machine (`15b6a5b0…`); other machines not tried; toolchain unpinned |
| license | — | MIT + Zlib | Zlib + Chromium BSD-3 (`cpu_features.c`, `insert_string.h`), as Node ships them |

Bundle numbers wire only the engine into the eager `zlib` module (`measure-bundles.sh`); the ported
handle + `lib/zlib.js` are not in them. No tree-shaking of unused pako wrappers was attempted.

### Host bridge (isolate only, `results/bench-bridge.txt`)

Sync `ivm.Callback` to the embedder's `node:zlib`: ~0.02 ms per crossing (0 B), 16 KiB deflate 0.054 ms
vs 0.027 ms native. A 0.5 MB gzip bomb inflates to 512 MiB in the **host** (RSS +967 MiB) before the
copy into a 64 MiB guest fails: host memory is outside every guest limit. Browser hosts still need an
engine; bytes would follow the embedder's Node, not v24.16.0.

### Sync engine vs today's async `CompressionStream` on a browser host (`results/async-vs-sync.txt`, Chromium 148)

Compress, 45 cases (3 formats × 5 inputs × level default/1/9): byte-identical 14, identical but the gzip
OS byte 5 more (Chromium on macOS writes 19), different 26 (`CompressionStream` ignores `level`); all 45
async outputs decode on the engine. Decode: 2-member gzip, gzip + 8×0x00, zlib + LF, zlib + `JUNK!` —
sync gives Node's result, async rejects `TypeError: Junk found after end of compressed data.` (4/4);
truncated — sync `Z_BUF_ERROR` `unexpected end of file`, async `TypeError: Compressed input was truncated.`

## Main today (`results/main-red.txt`, `bench-browser.txt`)

Every sync form, `crc32`, stream classes except `Gzip`, `Inflate.call`, `unzip`, `windowBits` and
`createGzip().flush()` throw on the browser host; everything compressing throws in the isolate; async
bytes ignore `level` (level 1 and 9 give the level-6 bytes); `inflate` rejects a trailing LF. Chromium
148's `DecompressionStream` (today's browser backend) rejects a 2nd gzip member and a trailing LF
(`TypeError: Junk found after end of compressed data.`, after the first member's bytes).

## Not measured

x64 / Windows Node output; the wasm build on another machine or with a pinned toolchain;
Firefox/WebKit; open-stream limits in Chromium and (with the engine) in the isolate; pako with
tree-shaken imports; the three bundle fallbacks of ADR-0573 §8; backpressure and event order of rifty's
`Transform` under these classes.

## Notes for implementers (traps met by this probe)

Inputs:
- Node source: `https://nodejs.org/dist/v24.16.0/node-v24.16.0.tar.xz`, sha256 in `fetch.sh`. `fetch.sh`
  extracts only `deps/zlib`, `src/node_zlib.cc`, `lib/zlib.js`; `run-all.sh` adds `test/parallel/test-zlib*`,
  `test/common`, `test/fixtures` with bsdtar's `--include` (GNU tar needs `--wildcards`). The tarball's
  `lib/zlib.js` equals the binary's builtin source:
  `require('internal/test/binding').internalBinding('builtins').natives.zlib` (`--expose-internals`).
- Chromium 108: the floor lane's runner (`playwright@1.28.1`; `install chromium` must run under
  `npm exec --package=node@18.20.8` — Node 24's extractor truncates on macOS), `PLAYWRIGHT_BROWSERS_PATH`
  pointing at its own directory.

Building `zlib.wasm`:
- `-DCPU_NO_SIMD` (Node's own non-SIMD branch) and the nine sources of `build-wasm.sh`; no SIMD sources,
  no `contrib/optimizations/inflate.c`. Do not define `CHROMIUM_ZLIB_NO_CASTAGNOLI`: Chromium's fork
  then falls back to vanilla zlib's Rabin-Karp hash and the bytes stop matching Node.
- `wasm32-wasip1` reactor with `--no-entry`: call `_initialize()` once before anything; the module
  imports nothing (no WASI), so instantiate with `{}`.
- z_stream on wasm32 is 14 × 4 = 56 bytes (`next_in`, `avail_in`, `total_in`, `next_out`, `avail_out`,
  `total_out`, `msg`, `state`, `zalloc`, `zfree`, `opaque`, `data_type`, `adler`, `reserved`); pass
  `zlibVersion()` and 56 to `deflateInit2_`/`inflateInit2_`.
- Exports are `i32`: a pointer ≥ 2 GiB comes back negative (`>>> 0`, `>>> 2` for word indexes);
  `malloc` returns 0 when the 4 GiB space is exhausted. Any call may grow memory and detach every
  `memory.buffer` view: re-create views after each call.
- The gzip header's OS byte is `OS_CODE` (`zutil.h`): 19 on macOS Node, 3 from this build.

Node's handle semantics (`driver.mjs` ports them; easy to miss):
- the output buffer persists across chunks (`_outOffset`): the next write continues in the remaining
  room, and level-0 (stored) output depends on it;
- GUNZIP: after `Z_STREAM_END` with input left, reset and continue only if the next byte is not
  `0x00`; UNZIP sniffs `1f 8b` across chunk boundaries (`gzip_id_bytes_read_`);
- `InitZlib` ignores `SetDictionary`'s error (it surfaces at the next write as `Zlib error`);
  `ResetStream` is a no-op for UNZIP before the sniff; the dictionary is the view's bytes
  (`buffer`/`byteOffset`/`byteLength`), never `new Uint8Array(view)` (that converts elements);
- `Z_BUF_ERROR`/`Z_OK` with output room left under `Z_FINISH` is `unexpected end of file`.

Harnesses:
- `swap-binding.cjs`: `process.binding('zlib')` is the same object as `internalBinding('zlib')`, and
  `lib/zlib.js` reads `binding.Zlib` at construction, so patching it in a `-r` preload swaps the engine
  under Node's own module. The preload must not import `node:zlib` (Node's tests patch
  `buffer.kMaxLength` before requiring it). Parallel Node tests need their own `TEST_SERIAL_ID`
  (shared `test/.tmp.N` otherwise).
- `zlib-diff.mjs`: `vm.compileFunction(source, ['exports','require','module','process','internalBinding','primordials'])`
  with the real `primordials`/`internalBinding` from `internal/test/binding`; the binding is
  `Object.create(realBinding)` with only `Zlib` replaced (brotli, zstd, `crc32` stay native). Compare
  whole values and never timing-dependent fields (`readableLength` before reading varies in Node).
- isolated-vm: no `performance` in the isolate (`Date.now` granularity — time from the host); live
  isolates keep the process alive (`process.exit`). `runCode`'s RSS sampler ticks every 25 ms: hold an
  allocation ≥ 500 ms to observe the pool's verdict.
- `measure-bundles.sh` edits source and rebuilds `dist/` of every packed package: run it on a clean
  tree and finish with the `none` variant (as `run-all.sh` does) so `dist/` is main's again.
