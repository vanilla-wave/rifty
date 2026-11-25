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
| `transform-path.mjs` | Node's one-shot path (`lib/zlib.js` ported over a `Transform` parameter) on Node's vs rifty's `Transform` (main) |
| `async-vs-sync.mjs` | unit 2's intermediate browser state: sync forms on the engine vs callback forms on Chromium's `CompressionStream` |
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
at member headers. Node's own suite proves API shape, not bytes: only 36 of its 47 deflate-family files
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

### Over rifty's `Transform` (`results/transform-path.txt`)

Node's one-shot path, 7 scenarios (callback valid / corrupt / `maxOutputLength` / `info`, gunzip of 2
members, sync valid / corrupt): the port over Node's `Transform` equals real Node in all 7. Over rifty's
`Transform`, bytes, error message and `code`, `info.engine` and callback/event order are Node's in all
7; `_destroy` never runs, so the handle stays open after every async one-shot and every error, and
`maxOutputLength` lets one more engine write through after `close()`. Only a successful sync call
closes its handle (`processChunkSync` does it itself).

### Cost (`results/bench-*.txt`, `chromium108.txt`, `memory.txt`, `streams-cap.txt`, `guest-wasm.txt`, `bundles.txt`)

| | node:zlib | pako 3.0.3 | wasm build |
|---|---|---|---|
| deflate L6 1 MiB / 50 MiB — Node main realm, ms | 25 / 1257 | 46 / 2440 | 31 / 1543 |
| inflate 1 MiB / 50 MiB — Node, ms | 1.6 / 77 | 5.8 / 308 | 2.7 / 138 |
| deflate / inflate 50 MiB — isolate, ms | — | 2379 / 304 | 1551 / 141 |
| deflate / inflate 50 MiB — Chromium 148 worker, ms | — | 2521 / 326 | 1559 / 143 |
| deflate / inflate 1 MiB — Chromium 108 worker, ms | — | 51.7 / 7.3 | 31.8 / 2.5 |
| first use in a fresh isolate (load + 1 KiB round trip), ms | — | 1.6 load + 2.9 | 1.4 incl. sync compile 0.16 + instantiate 0.09 |
| first use, Chromium worker (148 / 108), ms | — | 2.6 / — | 0.5 / 0.6 |
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
