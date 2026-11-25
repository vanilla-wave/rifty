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
