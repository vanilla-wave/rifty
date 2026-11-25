---
kind: epic
status: draft
title: node:zlib as in Node on every host — sync, streams, options, bytes and errors of the deflate family
created: 2026-11-24
value: A program that compresses or decompresses with node:zlib — exceljs, unzipper, pdfkit, pngjs, ws, or its own zlib calls — runs in any rifty host and writes the bytes real Node writes.
user_story: As an agent running model-written Node code in rifty, I want `zlib.inflateSync`, `createDeflateRaw`, `crc32` and the libraries built on them to work as in Node, but today every sync form and every stream except `createGzip` throws on browser hosts and every compressing member throws in the isolate host
tier: works
---

## Outcome

`node:zlib`'s deflate family — deflate, inflate, gzip, gunzip, deflateRaw, inflateRaw, unzip and
`crc32` — behaves as Node v24.16.0 on every rifty host: the browser hosts (Workbench, SDK) and the
isolate host guest. Every form (callback, `util.promisify`, `*Sync`, `create*`, the classes with and
without `new`), every option and stream member, the output bytes and the errors (message, `code`,
`errno`) are Node's. Libraries that compress through it write Node's files. Brotli and zstd stay
named loud gaps.

## User scenario

One program `main.js` and its input files, run as `node main.js` by real Node v24.16.0, by the
isolate host (sandbox `exec`) and by a browser host (Chromium, Workbench and SDK):

1. exceljs 4.4.0's streaming `WorkbookWriter` writes `out.xlsx` (archiver → crc32-stream's
   `class extends zlib.DeflateRaw`).
2. unzipper 0.10.14 lists and extracts `out.xlsx` (`Open.buffer` and a piped `Parse`, both
   `createInflateRaw`).
3. pngjs 7 `PNG.sync.write` then `PNG.sync.read` (`deflateSync`; `zlib.Inflate.call(this)` +
   `_processChunk` over `_handle`).
4. pdfkit 0.17 writes a compressed `out.pdf`; the program cuts its FlateDecode streams up to
   `endstream` (EOL kept) and reads each with `zlib.inflateSync`.
5. `zlib.gunzipSync` of a two-member `.gz`; `zlib.unzip` of gzip and zlib input.
6. ws 8 `PerMessageDeflate` (no socket): negotiate, compress with and without `fin`, decompress.
7. `zlib.crc32` of every file; `zlib.inflate` of a corrupt buffer reports its error.

Every file written and the stdout are what real `node main.js` produces from the same files (clock
frozen in the program; gzip OS byte per Decisions).

## Invariants

<!-- False on main 1c00c6292 (results: docs/backlog/runtime-js/reference/zlib-engine-probe/results/main-red.txt,
real Node vs rifty isolate host vs rifty's browser-host zlib module in-process over Node's
CompressionStream): deflateSync/inflateSync/gzipSync/crc32/createDeflateRaw/new Inflate/unzip throw
NotImplementedError on both hosts; `zlib.Inflate.call(this)` → TypeError "Class constructors cannot
be invoked without 'new'" (browser); async deflate level 1 and 9 both give the level-6 bytes
(ba448af7861f:92; Node 6976b92dbd62:134 / 2a02e1edd968:92); inflate + "\n" → ERR_TRAILING_JUNK
(Node: ok); corrupt inflate → TypeError "" [Z_DATA_ERROR] (Node: "invalid code -- missing end-of-block");
deflate {windowBits: 9} and createGzip().flush() throw; isolate: every one of those NotImplementedError
`isolate-host.zlib.*`. Chromium 148's DecompressionStream (the browser backend) rejects a 2nd gzip
member and a trailing LF: "Junk found after end of compressed data." (results/bench-browser.txt).
I5: packages/isolate-host/tests/library-exceljs.test.ts "a streaming write deflates: the named gap…"
pins `isolate-host.zlib.DeflateRaw`. -->

- I1. On every host every deflate-family member runs: the 7 one-shots (callback and
  `util.promisify`), the 7 `*Sync`, the 7 `create*`, the 7 classes (with `new`, without `new`,
  `util.inherits` + `X.call(this, opts)`) and `crc32`; none throws `NotImplementedError`.
- I2. Bytes are Node's: compressed output for every `level`, `memLevel`, `strategy`, `windowBits`,
  `dictionary`, `chunkSize`, flush sequence, `params()` and `reset()` (gzip OS byte per Decisions);
  decompressed output, including bytes after the stream end, zero padding and multi-member gzip.
- I3. Errors are Node's: corrupt, truncated, wrong-format, missing- or wrong-dictionary input and
  invalid arguments give Node's message, `code` and `errno` at Node's point (sync throw, callback,
  stream `'error'`); `finishFlush` and `maxOutputLength` outcomes as Node's.
- I4. Stream members are Node's: `flush(kind, cb)`, `params`, `reset`, `close`, `bytesWritten`,
  `info: true`, `rejectGarbageAfterEnd`, and the internals consumers read (`_handle.writeSync`,
  `_writeState`, `_outBuffer`, `_outOffset`, `_chunkSize`, `_processChunk`, `_finishFlushFlag`).
- I5. The scenario's libraries write Node's bytes on every host: exceljs streaming writer,
  unzipper, pngjs sync, pdfkit, ws permessage-deflate.

## Challenge

challenge: 2026-11-24 — 13 problems (one fresh read-only critic over the request, the user's words, goal, map, the three seeded items, ADR-0573 draft and the probe; premise and final-result check in one pass; each verified and fixed in this draft)

1. blocker — Outcome named the engine layout («one engine serves every host»), an agent choice in the user's goal, and the bridge rejection rested on it: removed; the bridge is rejected on Outcome «every rifty host» and I2.
2. «no observable difference» ignored embedder-observable memory (wasm outside `memoryLimit`, kept after close): Decisions now name it and the ADR-0563 decision that settles the class.
3. a stream dropped without close kept its wasm state for the realm's life: ADR-0573 §6 frees it through a `FinalizationRegistry` + fault test.
4. the engine was at once fog, Proposed and in the Outcome while units 2–3 were seeded on it: fog line removed; map Decisions show units 2–3 hold for either engine, the manager decides before unit 2.
5. fog let an agent drop a browser host: now «which harness» covers both Workbench and SDK.
6. «Node's suite 62/62 on the engine» overstated (brotli/zstd/`crc32` stayed native) and `crc32` was unmeasured: wording → 47 deflate-family files; `crc32` measured (32 cases, wasm 32/32; pako 3 exports none).
7. ADR-0557 §6 says «engine choice is the user's»: ADR-0573 records the user's delegation.
8–13. nits fixed: the manager's reading marked as such; Chromium 148's 2nd-member/LF rejection persisted (`results/bench-browser.txt`); pako guest +21 KB gzip; pako 2.2.0 date sourced (npm publish); the carrier's browser failure marked expected, not run; the OS-byte alternative recorded.

external review 2026-11-24 (manager-run, PR #448 @ 605ae7783; engine choice upheld): 1 blocker — unit 2 was not independent of streams (Node's one-shots are `new ctor` + `zlibBuffer` over `Transform`); units re-cut by Node's structure after a measurement on main (`results/transform-path.txt`, map); should/nit findings fixed in the probe, ADR-0573 and this goal.

## Decisions

- 2026-11-24 — user, on the fork «Движок zlib — pako / wasm-сборка zlib из Node / мост к хосту»: «исследуй и запускай». Manager's reading, not the user's words: research, then run the implementation without a new question unless the facts show a trade-off in observable behaviour; the engine is the manager's choice on the probe's facts (ADR-0573), not the user's.
- 2026-11-24 — brotli and zstd outside this goal, loud on every host: manager's scoping, user confirmation pending (the manager carries the question).
- 2026-11-24 — gzip header OS byte is 3 (zlib's default outside its platform table). Node writes 19 on macOS, 10 on Windows, 3 on Linux (`deps/zlib/zutil.h`, fixed at Node's build), so no single Node byte exists there; the carrier compares against Linux's. Not the byte of the browser's or embedder's OS: rifty's `process.platform` is `'rifty'`, in no row of that table.
- 2026-11-24 — against Node the probe saw no difference between pako 3.0.3 (+ a `deflateParams` port, + its own crc32) and the wasm build (1420-case matrix — the byte proof; Node's own test files, 36 of them through the engine — the API-shape proof; consumers 5/5): the engine choice trades cost, not Node-observable behaviour. Embedder-observable memory differs — wasm state sits outside the isolate `memoryLimit` and is kept after close (results/bench-isolate.txt, memory.txt) — and that class is already settled: ADR-0563 (memory outside the heap → the worker's RSS ceiling, neighbours exact once); Node's own zlib state is outside V8's heap too. No user question.
- 2026-11-24 — engine: the wasm build of Node v24.16.0's `deps/zlib` (ADR-0573), the manager's decision under the user's delegation above, not the user's choice.
- 2026-11-24 — declared residuals (not proven by the probe; owner and closer named):
  - Node's output on x64 — closed by unit 1: its oracle is a live `node` on the Linux x64 CI runner, compared on that runner (committed macOS digests would not observe x64).
  - Node's output on Windows — not closed: no Windows lane; CPU-independence of the bytes rests on the source (fixed deflate hash), the OS byte is declared above. Owner: runtime-js, on a Windows lane's arrival.
  - the wasm build on another machine — unit 2's Acceptance (pinned toolchain, rebuild on the CI runner, same sha256).
  - Chromium 108, ADR-0469's supported floor (measured `results/chromium108.txt`): in a Worker the engine compiles synchronously and round-trips; on the page main thread sync compile and sync instantiation > 4 KB are refused. Guest code runs in Workers on every browser host, so the engine must compile on first use, never at module load (unit 2's Acceptance); the SDK page's own import failure stays `runtime-js/chromium108-sdk-sync-wasm-import`'s.
  - Firefox (verified tier) and WebKit (capability-verified): not run; their dispatched lanes record them (ADR-0469).
  - pako tree-shaking — moot after the engine decision; reopened only by ADR-0573 §8's kill condition.
- 2026-11-24 — declared residual under tier works, open streams (an open deflate stream holds 302776 B of linear memory, 450232 B at `memLevel: 9`; inflate 58327 B; `results/streams-cap.txt`), per host:
  - in a Node process (measured): 10000 deflate streams = 2888 MiB; the 4 GiB wasm32 space ends at 14182 (9538 at `memLevel: 9`) and the next one errors `Zlib error` `Z_MEM_ERROR`, where Node keeps going (10000 open: RSS +2201 MiB);
  - isolate host (computed, not run with the engine): the worker's RSS ceiling (256 MiB + 3 × the calls' limits, ADR-0563 §5) comes first — ≈ 1400 deflate streams at `memoryLimitMb: 64`, ≈ 3000 at 256 — outcome `termination: 'memory'` (or the neighbours' rerun), the same accounting that ends a guest's own 512 MiB `WebAssembly.Memory` (3/3, held 500 ms, `results/guest-wasm.txt`);
  - Chromium: not measured;
  - everywhere: linear memory is not returned after close (reused by later streams).
- tier: works — the user's choice 2026-11-25: «ок» in the manager thread cf2ae711 on the manager's `works` (asked there as: ordinary work and every Node error as in Node; rare failures — out of memory, engine init — throw loudly; freeing abandoned streams' memory carries a test either way). Was the manager's provisional default 2026-11-24.
- rejected route: keep web `CompressionStream` behind the async forms — violates I2 (`level` ignored; trailing bytes rejected; Chromium throws on a 2nd gzip member).
- rejected route: the isolate guest calls the embedder's `node:zlib` over the bridge — alone it leaves the browser hosts without zlib (Outcome «on every rifty host»), and its bytes are the embedder's Node version's, not v24.16.0's (I2). Costs in ADR-0573 §Alternatives.
- rejected route: pako 1.0.11 (already in the lockfile) — violates I2: 221 of 1420 probe cases differ.
