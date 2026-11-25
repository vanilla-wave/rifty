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
   (`vendor/`/`generated/` manifest of PR #445; this PR is held, so the entry goes in when it is
   brought up to `main` before its final ready — `generated/` without one turns that check red) → ADR-0573
5. Every engine pointer is checked: a failed allocation is a loud error, with a test that exhausts the
   wasm memory → ADR-0573
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
| the port's buffer allocation fails | loud `RangeError`, never a write at address 0 | Acceptance 5 | → ADR-0573 |

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
- 2026-11-25 — author: licence record = `generated/LICENSE` (Node's deps/zlib section, Chromium BSD-3, Node MIT); PR #445's manifest is not on `main`. Owner: this unit — the entry goes in when the held PR is brought up to `main` before its final ready (manager, review round 1).
- 2026-11-25 — manager: the client budget is the user's decision (ADR-0573 §8: generic 327680/332000 B gzip with engine + handle, 4320 B left before the ≈ 8.5 KB `lib/zlib.js` port; options: the cap re-derived by its own ×1.5 rule, the engine as a separate file, pako); asked 2026-11-25, no answer — unit 3 does not start without it.
- 2026-11-25 — author (review round 1): the wasm copies of the caller's in/out live between writes as Node's z_stream pointers do — `params` after a write deflates into the previous `out` (was: into freed memory), lib/zlib.js's continuation write (same buffer, from where zlib stopped, same end) reuses the input copy, any other write copies afresh (copying linear: raw inflate 16/32/64 MiB 8/14/32 ms, was 210/884/3110; deflate 290/570/1160 ms, was 4368 at 64 MiB; standalone, doubling ≤ 2.3× inflate, ≤ 2.04× deflate). Gate: `tests/zlib-engine/scaling.test.ts` counts the bytes JS copies into wasm (16 MiB inflate ≤ input + output + 32 KiB; the per-call copy: 8.6 GB) — not milliseconds: under test:run's load the fixed handle's 16 → 64 MiB time ratio reached 10–15×, the quadratic one's 14–19×. Declared: input bytes the caller changes while one lib/zlib.js write is still in its continuation calls are not seen (Node reads them live; its stream contract forbids it); a buffer refilled after its write completed is read anew (`native.test.ts`).
- 2026-11-25 — author: declared binding-level residual: Node's native SIMD inflate (chunk copy, contrib/optimizations) leaves scratch bytes in `out` past the reported output and before an error; the engine's non-SIMD inflate (ADR-0573 §1) leaves none. Reported output, `_writeState` and errors equal (`tests/zlib-engine/native.test.ts`, 2000 seeded sequences vs `process.binding('zlib')`); lib/zlib.js reads only reported bytes.
- 2026-11-25 — author: `zlib-wasm:generate`/`:rebuild` require Node v24.16.0 (wasm-opt.js's runtime, pinned in `sources.json`) and say so before building; `--check` runs on any Node. No toolchain pin for darwin-x64 or Windows: the generator refuses them by name.
- 2026-11-25 — author: declared: `check:arch` sees imports, not `new URL('…/zlib-engine/…', import.meta.url)` asset references (none exist; zlib-engine/README.md).
