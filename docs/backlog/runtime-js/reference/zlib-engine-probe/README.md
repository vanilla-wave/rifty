# zlib engine probe (2026-11-24)

Which engine computes rifty's `node:zlib` on every host. Measured against live Node v24.16.0
(zlib `1.3.1-e00f703`, Chromium fork), macOS arm64 M3 Pro, isolated-vm 7.0.2, Chromium 148.0.7778.96
(`@playwright/test` 1.60.0). Decision: ADR-0573 (draft). Goal: `docs/backlog/epics/node-zlib-on-every-host/`.

## Run

```sh
sh run-all.sh /tmp/zep-deps /tmp/zep-build    # two empty dirs outside the repo; writes results/*.txt
```

Downloads (npm tarballs, Node source) are sha256-pinned in `fetch.sh` and land only in `DEPS`;
scripts stay here. Toolchain for the wasm build: Homebrew `llvm lld wasi-libc wasi-runtimes binaryen`
(llvm 23.1.6, wasi-libc 34, binaryen 133). `measure-bundles.sh` edits `runtime-js/src/builtins/zlib.ts`
for one build and restores it on exit — run it on a clean tree.

| Script | Measures |
|---|---|
| `driver.mjs` | Node's handle semantics, engine-independent: port of `node_zlib.cc` ZlibContext (init, dictionary, gzip members, unzip sniff, error mapping, params, reset) + `lib/zlib.js` `processChunkSync` |
| `engines.mjs` | z_stream adapters: pako 1/2/3, `pako@3.0.3+params` (zlib 1.3.1 `deflateParams` ported over pako's private state), the wasm build |
| `cases.mjs` | 1418 cases, Node oracle vs each engine through `driver.mjs` |
| `swap-binding.cjs` | preload: Node's native `binding.Zlib` → `driver.mjs` over an engine, so Node's **own** `lib/zlib.js` runs on it |
| `node-suite.mjs` | Node's own `test/parallel/test-zlib*.js` (62) natively and per engine, through the swap (only `binding.Zlib` swapped: brotli, zstd and `binding.crc32` stay native) |
| `consumers.mjs` + `consumer-scenarios.cjs` | exceljs streaming writer, unzipper, ws permessage-deflate, pngjs sync, pdfkit — digest of their output, native vs engine |
| `highlevel.mjs` | controls without a z_stream API: fflate, wasm-flate |
| `bench-*.mjs`, `bench-core.js`, `memory.mjs` | speed (Node, isolate, Chromium worker), first use, memory, host bridge |
| `guest-wasm.mjs` | whether a guest already allocates wasm memory outside its `memoryLimit` (`runCode`) |
| `streams-cap.mjs` | wasm bytes per open stream; streams one realm opens before the wasm32 4 GiB space ends; 10000 native streams |
| `measure-bundles.sh` | real bundle cost: `pnpm test:client-bundles` + isolate guest build per engine |
| `main-red.mjs` | the same calls on main: real Node vs rifty isolate host vs rifty's browser-host module |

## Results

### Behaviour (`results/cases.txt`, `node-suite.txt`, `consumers.txt`, `highlevel.txt`)

| | pako 1.0.11 | pako 2.2.0 | pako 3.0.3 | pako 3.0.3 + params port | wasm build of Node's deps/zlib | fflate 0.8.3 | wasm-flate |
|---|---|---|---|---|---|---|---|
| 1418-case matrix = Node | 1199 | 1413 | 1381 | 1386 | **1418** | — (no z_stream) | — |
| compressed bytes, 264 level × format × input | 114 | 264 | 264 | 264 | 264 | 9/28 (raw) | 1/7 |
| `params()` (deflateParams) | ✗ absent | ✗ absent | ✗ absent | 5/5 | 5/5 | ✗ | ✗ |
| `crc32(data, value)`, 32 cases | 32 | 32 | not exported | not exported | 32 | — | — |
| inflate edges: tails, members, truncation, corrupt, 900 fuzz, dictionary, windowBits | 1 diff (gunzip `windowBits: 0` → false `Z_DATA_ERROR`) | all | all | all | all | 2 members → 1st only; fuzz same outcome 49/300, same text 2/300 | — |
| Node's own test-zlib*.js: 62 files, 47 of them deflate-family on the engine (15 brotli/zstd and `crc32` native) | 59 | 60 | 60 | **62** | **62** | — | — |
| exceljs / unzipper / ws / pngjs / pdfkit = native bytes | — | — | 5/5 | 5/5 | 5/5 | — | — |

Not candidates by API: zlib-wasm 1.0.7 (two base64 one-shot functions, async load, pako fallback);
libdeflate-wasm 1.0.0 (whole-buffer API by design — no stream, flush or dictionary; from its README,
not run); fflate/wasm-flate (above).

Node's own output is **not** platform-stable in one byte: the gzip header OS field (each member) is the
build's `OS_CODE` — 19 macOS, 10 Windows, 3 elsewhere (`deps/zlib/zutil.h`). Not a criterion; every
engine writes 3. All other bytes: no CPU dependence by source (deflate hash is Chromium's fixed
"ANZAC++" multiply, SIMD paths are slide_hash/crc/chunk-copy — output-neutral); x64 Node not run.

### Cost (`results/bench-*.txt`, `memory.txt`, `bundles.txt`)

| | node:zlib | pako 3.0.3 | wasm build |
|---|---|---|---|
| deflate L6 1 MiB / 50 MiB — Node main realm, ms | 25 / 1257 | 46 / 2440 | 31 / 1543 |
| inflate 1 MiB / 50 MiB — Node, ms | 1.6 / 77 | 5.8 / 308 | 2.7 / 138 |
| deflate / inflate 50 MiB — isolate, ms | — | 2379 / 304 | 1551 / 141 |
| deflate / inflate 50 MiB — Chromium worker, ms | — | 2474 / 307 | 1512 / 141 |
| first use in a fresh isolate (load + 1 KiB round trip), ms | — | 1.6 load + 2.9 | 1.4 incl. sync compile 0.16 + instantiate 0.09 |
| first use, Chromium worker, ms | — | 2.5 | 0.5 |
| sync `new WebAssembly.Module` (64 KB) | — | n/a | ok: isolate, worker, Chromium 148 main thread (Chromium 108 main thread refuses > 4 KB: `chromium108-sdk-sync-wasm-import`) |
| client bundles generic / toolchain, Δ min / Δ gzip, B | baseline 932920/279754, 1061998/323615 (caps 1124000/332000, 1284000/386000) | +44561/+14198, +44626/+13945 | +86372/+36950, +86456/+36855 (inline base64) |
| isolate guest.js Δ raw / Δ gzip, B (unminified bundle) | baseline 7123270/1497917 | +110158/+20573 | +86545/+36857 |
| 100 deflate + 100 inflate streams open → closed | — | 33.4 → 0.2 MiB JS heap (GC'd) | 38 → 38 MiB linear memory (never shrinks; reused on reopen) |
| counted by isolate `memoryLimit` | — | yes (JS ArrayBuffers) | **no**: 512 MiB `memory.grow` under a 64 MiB limit succeeds (bare isolated-vm). A `runCode` guest already fills its own 128 MiB `WebAssembly.Memory` under 64 MiB, exit 0 (3/3); 512 MiB ends `termination: 'memory'` (3/3) — `guest-wasm.txt` |
| open streams, wasm (`streams-cap.txt`) | 10000 deflate: RSS +2201 MiB | — | deflate 302776 B each (450232 at `memLevel: 9`), inflate 58327 B; 10000 deflate = 2888 MiB; the 4 GiB space ends at 14182 deflate (9538 at `memLevel: 9`): next one `Zlib error` `Z_MEM_ERROR` |
| reproducible build | npm tarball | npm tarball | same sha256 twice on one machine (`15b6a5b0…`); other machines not tried |
| license | — | MIT + Zlib | Zlib + Chromium BSD-3 (`cpu_features.c`, `insert_string.h`), as Node ships them |

Bundle numbers wire the whole engine into the eager `zlib` module (`measure-bundles.sh`); no tree-shaking
of unused pako wrappers was attempted.

### Host bridge (isolate only, `results/bench-bridge.txt`)

Sync `ivm.Callback` to the embedder's `node:zlib`: ~0.02 ms per crossing (0 B), 16 KiB deflate 0.054 ms
vs 0.027 ms native. A 0.5 MB gzip bomb inflates to 512 MiB in the **host** (RSS +967 MiB) before the
copy into a 64 MiB guest fails: host memory is outside every guest limit. Browser hosts still need an
engine; bytes would follow the embedder's Node, not v24.16.0.

## Main today (`results/main-red.txt`, `bench-browser.txt`)

Every sync form, `crc32`, stream classes except `Gzip`, `Inflate.call`, `unzip`, `windowBits` and
`createGzip().flush()` throw on the browser host; everything compressing throws in the isolate; async
bytes ignore `level` (level 1 and 9 give the level-6 bytes); `inflate` rejects a trailing LF. Chromium
148's `DecompressionStream` (today's browser backend) rejects a 2nd gzip member and a trailing LF
(`TypeError: Junk found after end of compressed data.`, after the first member's bytes).

## Not measured

x64 / Windows Node output; the wasm build on another machine; Firefox/Safari; Chromium 108 worker sync
compile; pako with tree-shaken imports; a wasm-as-asset (ADR-0352-style preload) bundle variant; rifty's
own streams under these consumers (no engine in rifty yet — the goal's carrier finds those walls).
