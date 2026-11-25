---
area: runtime-js
status: ready
title: The wasm build of Node's deps/zlib, reproducible from a pinned toolchain, and a port of Node's zlib handle land in runtime-js, proven against Node, with no guest surface
created: 2026-11-24
why: The engine and the handle are the only parts of node:zlib that stand on nothing in rifty's streams; building and proving them in parallel with the streams goal leaves lib/zlib.js one port away
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md]
code: [packages/runtime-js/src/builtins/zlib.ts]
---

## Context

Unit 2 of the goal (manager 2026-11-24, after round 3 of the external review of PR #448). Node's zlib
classes are `Transform` subclasses, so `lib/zlib.js` comes to rifty only on a `Transform` equal to
Node's (unit 3, `runtime-js/zlib-node-lib-port`). This unit lands what stands on nothing in rifty's
streams: ADR-0573's `zlib.wasm` with a reproducible build, and a port of `node_zlib.cc` ZlibContext as
Node's handle (`init`/`write`/`writeSync`/`params`/`reset`/`close`, `_writeState`, `onerror`). Nothing a
guest can call changes and no bundle carries either: they are imported only by their tests until
unit 3 imports them. The manager holds this unit's merge until unit 3 can follow it (map: adjacent
merges), so `main` does not carry code without a caller for an open-ended time.

Proof levels the probe established (`docs/backlog/runtime-js/reference/zlib-engine-probe/`):
- binding semantics over the engine — `cases.mjs`, 1420 cases through `driver.mjs` `Context`
  (`results/cases.txt`);
- the handle wrapper (`handle.cjs`) under Node's own `lib/zlib.js` — Node's `test-zlib*.js` 62/62
  (`results/node-suite.txt`) and `zlib-diff.mjs` column `port/N` = real Node, state group 45/45, load group 1/1
  (`results/zlib-diff.txt`).

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge) and the three external review rounds of PR #448; re-cut after rounds 2 and 3

## Acceptance

1. The product handle runs the probe's matrix — every group of `cases.mjs`, 1420 cases incl. `crc32` —
   against live `node:zlib` as a runtime-js test, through the handle's own API (not a separate driver)
   → I2, I3
2. Node v24.16.0's own `lib/zlib.js`, loaded verbatim from the sha256-pinned tarball as
   `zlib-diff.mjs` loads it, runs over the product handle with Node's `stream.Transform` in a
   Node-hosted test: the deflate-family `test-zlib*.js` files that write through a handle pass, and
   every `zlib-diff.mjs` scenario of column `port/N` equals real Node → I1, I3, I4
3. `zlib.wasm` is built by a pinned toolchain — clang/lld, wasi-libc and binaryen named by release and
   digest (a container image or release tarballs, not whatever Homebrew has) — and the committed
   sha256 is that toolchain's output; the Linux CI runner rebuilds it from the sha256-pinned Node
   tarball and matches it → ADR-0573
4. The binary (Zlib + Chromium BSD-3) and the ported Node code (MIT) are in the licence record
   (`vendor/`/`generated/` manifest of PR #445) → ADR-0573
5. Every engine pointer is checked: a failed allocation is a loud failure through Node's error channel
   (`onerror` `Z_MEM_ERROR`, as zlib's own; `crc32`, which has none, throws RangeError), with a test
   that exhausts the wasm memory → ADR-0573
6. No guest-visible change and no bundle growth, checked mechanically: a `check:arch` rule
   (dependency-cruiser, `tools/checks/arch-rules.cjs`) forbids any import of the engine or the handle
   module from rifty's builtin modules and from the isolate guest's `ceiling-zlib.ts` — unit 3 removes
   the rule; the PR body records `pnpm test:client-bundles` (main/sw/generic/toolchain min and gzip)
   and the isolate `guest.js` size, before and after, byte-equal to `main`; every existing zlib
   conformance, parity and isolate row stays green unmodified → ADR-0573

## Parity cases

Oracle: Node v24.16.0 (`node:zlib`, live), at the handle's level.

1. Compressed bytes per format × level −1, 0…9 × the probe's seven inputs → I2
2. `strategy` 1–4; `memLevel` 1/4/9 × `windowBits` 8/9/12/15; `chunkSize` 64/1024/65536 at levels
   0/6; dictionary for zlib and raw → I2
3. Flush sequences per write (`Z_NO_FLUSH`, `Z_PARTIAL_FLUSH`, `Z_SYNC_FLUSH`, `Z_FULL_FLUSH`,
   `Z_BLOCK`) at levels 0/1/6/9; `params` changes after a sync flush; `reset` after a full flush → I2
4. Inflate: tails, truncation, ten flipped positions, 900 seeded corruptions, `finishFlush`,
   `maxOutputLength`, chunked writes → I2, I3
5. gzip members, zero padding, `windowBits` 0, unzip sniff (split after `1f`), wrong format,
   dictionary missing/wrong/right → I2, I3
6. `crc32` over the seven inputs × initial values 0, 1, 0xffffffff, 0x12345678 → I1

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| wasm compile/instantiate fails | the handle's first operation throws a named error; no fallback engine | unit test with a corrupt module | → ADR-0573 |
| zlib's own allocation fails (realm wasm space exhausted) | Node's `Zlib error` `Z_MEM_ERROR` through `onerror` | handle test opening states until 4 GiB | → ADR-0573 |
| the port's buffer allocation fails | `onerror('insufficient memory', Z_MEM_ERROR)` in the sync and async paths, handle consistent, a pending close runs; never a write at address 0 | Acceptance 5 | → ADR-0573 |

## Out of scope

- Every guest-visible `node:zlib` change — `crc32`, classes, `*Sync`, `create*`, callback forms, the
  engine entering a bundle (lazy compile, the import instrumentation test, the Chromium 108 floor run,
  the chunk/budget measurement): `runtime-js/zlib-node-lib-port` (unit 3).
- Brotli and zstd: `NotImplementedError` on every host, compat ❌ (manager's scoping, user confirmation
  pending).
- Node's output on Windows (no lane; goal Decisions).

## Decisions

- 2026-11-24 — manager: one chokepoint, dependency order — `lib/zlib.js` only on a `Transform` equal to Node's; this unit carries the engine build and the handle, nothing guest-visible.
- 2026-11-24 — manager (round 3, revoking «engine in the bundle for `crc32`»): no guest surface and no bundle here (§Simplicity: a full engine without a caller until unit 3 — ≈ 24 KB gzip of deflate/inflate in every bundle against ≈ 15 KB generic headroom); `crc32` and the engine's entry into the bundles move to unit 3.
- 2026-11-24 — manager: this unit's merge is held until unit 3 can follow (`zlib-diff.mjs` state group = 0 on `main`). Mechanics: the PR is titled with `[hold: merges with zlib-node-lib-port]`; it is GitHub-ready only for a full CI run and the external review, and goes back to draft after a clean review; it stays draft until the condition holds; the manager merges it — before that, ready again and a fresh full CI run on the current `main`.
- Engine and placement per ADR-0573.
- 2026-11-25 — manager: toolchain = wasi-sdk-34 release tarballs (clang/lld 23.1.0 + wasi-libc in one release), one per host; URL + sha256 only in `generated/sources.json`, checked before unpacking; macOS vs Linux bytes compared before CI.
- 2026-11-25 — manager: binaryen dropped — on «wasm-opt saves 334 B raw» (the probe's 64797 → 64463).
- 2026-11-25 — manager, revising the line above: binaryen back, `binaryen-version_133-node.tar.gz` (wasm-opt's JS/wasm build, one binary on every host) pinned by sha256, run as an explicit step with pinned flags. Ground: the probe's «raw» build was already wasm-opt'd by clang's driver (Homebrew binaryen on PATH); the real cost of dropping it is ≈ 1.6 KB gzip of the inline base64 (36541 vs 34954 B); returning it costs one 2.3 MB pinned archive and one deterministic step. (Written first as «≈ 10 % of 15296 B headroom»; measured on `main` c2d03ce05 with engine + handle wired in, 4320 B are left under the generic cap: ≈ 1.6 KB is ≈ 37 % of the real headroom.)
- 2026-11-25 — manager: artifact = generated module in git (`zlib-engine/generated/zlib-wasm.js` base64 + `sources.json` + `LICENSE`), `pnpm zlib-wasm:generate`; `check:zlib-wasm-drift` (no toolchain) on the light path; `zlib-wasm:rebuild` (toolchain) as a step of `unit-and-conformance`/`run` — no new job, `CI gate` unchanged.
- 2026-11-25 — author: clang and wasm-opt run with an empty environment (clang: PATH = toolchain bin) — the driver runs any `wasm-opt` on PATH at -O2 and took `-I/usr/local/include` from the host env; link keeps `target_features` (`--strip-debug`) for wasm-opt's feature set, wasm-opt `-O3` (the probe's level) strips it. Result: 63202 B, sha256 `f40cd936…`, equal on darwin-arm64, linux-arm64, linux-x64.
- 2026-11-25 — author: `check:arch` rule `zlib-engine-has-no-production-importer` forbids every non-test importer of `runtime-js/src/zlib-engine/` (builtins and `ceiling-zlib.ts` included).
- 2026-11-25 — author: as Node's `Init`, the handle's `init` touches no zlib; the engine compiles at the first write/`params`/`reset`/`crc32` (Node's `test-zlib-unused-weak.js` measures exactly that).
- 2026-11-25 — author: Node test inputs (lib/zlib.js, the 47 deflate-family `test-zlib*.js`, their `test/common` + fixtures, 3 corpus sources) vendored by the generator under `runtime-js/tests/fixtures/zlib-engine/node/`, sha256 in `sources.json`, re-extracted and compared by `--rebuild`: the tests run offline.
- 2026-11-25 — author: licence record = `generated/LICENSE` (Node's deps/zlib section, Chromium BSD-3, Node MIT) + the `tools/publishing/third-party-manifest.json` record for `zlib-engine/generated/` (PR #445, merged): `zlib-wasm.js` + `LICENSE` as Node's `v24.16.0` (`sourcesKey: node.version` — the checker now reads a dotted nested pin), `sources.json`/`zlib-wasm.d.ts` first-party, marked `unshipped: runtime-js/zlib-node-lib-port` — no package ships the engine before unit 3, and a package that does is red until unit 3 drops the mark. The vendored Node tests (`tests/fixtures/zlib-engine/node/`) are in no `vendor/`/`generated/` dir and no package.
- 2026-11-25 — manager: the client budget (ADR-0573 §8: generic 327680/332000 B gzip with engine + handle, 4320 B left before the ≈ 8.5 KB `lib/zlib.js` port) — answered: the cap is recalibrated by the ×1.5 rule in the PR that crosses it — recorded by the manager in the zlib goal's Decisions; lazy chunk / separate file / pako stay options for a growth larger than measured, not an ordered obligation.
- 2026-11-25 — author (review rounds 1–2): the output copy lives between writes as Node's z_stream pointer into `out` does — `params` after a write deflates into the previous `out` (was: into freed memory); only bytes zlib wrote (up to next_out) go back, so a write costs O(its output), not O(the `out` window). The input is snapshotted when a write starts and dropped once consumed; lib/zlib.js's continuation writes (same buffer, from where zlib stopped, same end) read the snapshot, any other write copies afresh. Copying linear: raw inflate 16/32/64 MiB 8/14/32 ms, was 210/884/3110; deflate 290/570/1160 ms, was 4368 at 64 MiB (standalone). Gate: `tests/zlib-engine/scaling.test.ts` (`copy-count.mjs`, Node's own lib/zlib.js: sync, callback, stream, 2-member gunzip, `chunkSize` 1 MiB × 4000 writes): bytes copied in = input, out = output, exactly — not milliseconds (under test:run's load linear and quadratic time ratios overlapped: 10–15× vs 14–19× for 16 → 64 MiB). (Round 3: no output copy is kept between calls any more; wasm memory itself never shrinks.)
- 2026-11-25 — manager (review round 2): **declared limit, not a fix** — input changed by the caller between the continuation writes of one operation. Node reads the caller's memory live at every call; the port reads the snapshot taken when the operation's first write started. Reachable through lib/zlib.js: its async path pushes output (`'data'`, synchronous listeners) before issuing the continuation write. Same class: a `SharedArrayBuffer` input changed by another thread, a resizable `ArrayBuffer` resized mid-operation. Pinned both ways in `lib-zlib-diff.mjs` group `declared`: inflate, input filled in the first `'data'` — Node `Z_BUF_ERROR unexpected end of file`, port the original 202000 B; level-0 deflate of 200000 × `a`, input filled with `A` in the first `'data'` — Node 134464 `A` in the output, port 0. Route to close: feed the input in bounded windows re-read live, with byte parity per level and strategy proven (`deflate_stored` output depends on how input arrives). Compat ⚠️ in unit 3.
- 2026-11-25 — manager (review round 3): **one memory model, one declared class** (supersedes the round-2 line above as a separate decision): the handle copies — a write's input is snapshotted when `write`/`writeSync` is called, its output copied into the caller's `out` when the work ends, and between calls only the unconsumed rest of one operation's input is kept (lib/zlib.js's continuation writes read it); Node's zlib reads and writes the caller's memory live. Every difference this implies is one class, each manifestation pinned with both sides' literal results: input changed between one operation's continuation writes (`lib-zlib-diff.mjs` group `declared`, above); `in`/`out` overlapping in one `ArrayBuffer` — deflate 60000 B into the same buffer: Node `559:7bfc48c231687329`, port `558:4d7399c41ffea3e7`; inflate with `out` = in + 50: Node `Z_BUF_ERROR unexpected end of file`, port inflates (`23aa90589ba8c145`); `params()` after the last `out` was transferred — Node deflates into the moved memory (`c7d95273b18f3f65`), the port has nowhere to (`897cc061e2d5ca9a`) (`native.test.ts` «declared», Node's values equal on macOS arm64 and Linux x64/arm64); `SharedArrayBuffer` written by another thread, resizable `ArrayBuffer` resized mid-operation, input changed after an async `write()` before it completes (Node races: the new bytes in 29 of 30 runs; port: the original), `params()`/`init()` during an async write (Node races) — the same class, named, not pinned (Node's side is not deterministic). Fixed by the model, not declared: an async write's input is taken in `write()` (was: when the scheduled work ran — `d.write(buf); buf.buffer.transfer()` gave an empty stream; Node 121 B / 100000 inflated; `lib-zlib-diff.mjs` group `memory`, RED → GREEN); no output copy is kept between calls (`params` deflates through a temporary one); a failed port allocation — sync or async, input snapshot, output, dictionary — reaches `onerror('insufficient memory', Z_MEM_ERROR)` with the handle consistent and a pending close run (was: a RangeError thrown from the scheduler).
- 2026-11-25 — author (review round 2): a failed port allocation leaves no stale state — the input snapshot's continuation mark is reset with every fresh copy (a write whose `out` copy failed made the next write read 50 bytes before its copy); the dictionary's wasm copy is made before `deflateInit2_`/`inflateInit2_` and kept until `close`, so its allocation failure (now `onerror` Z_MEM_ERROR, round 3) leaves zlib uninitialised and the retry writes Node's FDICT stream (was: `789c…` without the dictionary). RED → GREEN in `engine.fault.test.ts`.
- 2026-11-25 — author (review round 4): the model holds at the call as a whole — `write()` loads the engine (`ZlibEngineError` from the call, nothing left in progress; was: a first write with no input left `write in progress` for good), snapshots the input and fixes `out`'s length and null-ness (an `out` transferred before the async work completes: state `[4032, 0]` and the callback as Node's, the bytes lost — Node `ea19b47b2e361ec9` in the moved memory, port `ad7facb2586fc6e9`; was: `onerror('stream error')` and no callback); any other exception still ends the write (and runs a pending close). A buffer already transferred away reads as Node reads it — length 0, a null pointer; where the bounds check then fails (`off + len > 0`: Node aborts, `node_zlib.cc` `CHECK(Buffer::IsWithinBounds)`) it is `onerror('stream error', Z_STREAM_ERROR)` (round 5: was for any length — `zlib.deflateSync(transferred)`, `gzipSync`, a stream `write(transferred)` threw where Node gives `789c030000000001`, a valid gzip, `789ccbc80400013b00d2`; now equal, `lib-zlib-diff.mjs` group `memory`); pinned for an inflate input transferred before its continuation write and a `'data'` chunk's buffer transferred (`lib-zlib-diff.mjs` group `aborts`, port only). Dropping an input snapshot also clears zlib's `next_in`/`avail_in` (a failed `out` copy left them pointing into the freed one). After a second `init()` the dictionary copy is made at first use (`reset`, Z_NEED_DICT); its failure is `onerror` Z_MEM_ERROR (tested). Declared, not aligned: Node's own zlib `Z_MEM_ERROR` is sticky (init failure → mode NONE), the port's allocation failure leaves the handle usable — Node has no allocation there to fail (port side pinned: the retry completes).
- 2026-11-25 — author (review round 5): an internal failure inside a write (a broken check, a wasm trap — where Node's process would abort) is a loud exception, never `onerror`: a `finally` ends the write and runs a pending close; if that close throws too, the write's exception still propagates and the close's is raised after (queued microtask). Pinned by an injected `deflate` throw, sync and async, with and without a pending close (`handle.test.ts`; the mutant without the `finally` is red).
- 2026-11-25 — author (review round 6): one entry for every caller buffer — `nodeBytes` in `handle.ts` (input, output, dictionary, `crc32` data, `writeResult`) gives what Node's Buffer::Data/Length see: a transferred-away buffer is length 0 and a null pointer; `windowOf` then applies Node's bounds CHECK (`DETACHED_ERROR` only where it fails on a detached buffer). No other read of an incoming buffer's `buffer`/`byteOffset`/`byteLength` remains (grep). Was: `crc32(transferred, 5)` and a transferred `dictionary` threw `TypeError` where Node gives `5`, `789ccb48cdc9c90700062c0215`, `68656c6c6f` (now `lib-zlib-diff.mjs` group `memory`, 8/8 = Node, with the product's `binding.crc32`); `native.test.ts` enumerates every entry point with a transferred buffer — Node's result where it has one, the port's where Node aborts (`writeResult`: the check; in/out with `off + len > 0`: `onerror` Z_STREAM_ERROR).
- 2026-11-25 — author (review round 7): an `out` of length 0 is a null pointer only where Node's Buffer::Data is NULL — an empty fixed-length `ArrayBuffer`/`SharedArrayBuffer` or a detached one; an empty resizable/growable buffer keeps a pointer (`avail_out` 0, no error at `Z_NO_FLUSH`); was `Z_STREAM_ERROR`. Five rows vs `process.binding('zlib')` in `native.test.ts`.
- 2026-11-25 — author: declared binding-level residual: Node's native SIMD inflate (chunk copy, contrib/optimizations) leaves scratch bytes in `out` past the reported output and before an error; the engine's non-SIMD inflate (ADR-0573 §1) leaves none. Reported output, `_writeState` and errors equal (`tests/zlib-engine/native.test.ts`, 2000 seeded sequences vs `process.binding('zlib')`); lib/zlib.js reads only reported bytes.
- 2026-11-25 — author: `zlib-wasm:generate`/`:rebuild` require Node v24.16.0 (wasm-opt.js's runtime, pinned in `sources.json`) and say so before building; `--check` runs on any Node. No toolchain pin for darwin-x64 or Windows: the generator refuses them by name.
- 2026-11-25 — author: declared: `check:arch` sees imports, not `new URL('…/zlib-engine/…', import.meta.url)` asset references (none exist; zlib-engine/README.md).
