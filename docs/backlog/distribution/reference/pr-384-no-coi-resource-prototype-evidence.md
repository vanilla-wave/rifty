# PR 384 no-COI resource prototype — durable record (2026-10-26)

Provenance: throwaway branch `prototype/no-coi-resource-economy`, commit
`1f0cd3a0d`, PR https://github.com/vanilla-wave/rifty/pull/384 (throwaway,
never a merge candidate). Branch artifacts rot; load-bearing numbers inlined
here. Runner, full raw/summary/host JSON + rendered app:
`tools/perf/no-coi-resource-prototype/` on that commit (also
`refs/pull/384/head`). Re-verify against current main before building on it.

Environment: Apple M3 Pro (12 logical CPUs), 36 GiB; macOS arm64; Chromium
148.0.7778.96 headless (Playwright `launchServer`); Node 24.16.0; dev module
host `pnpm dev:no-coi` (unbundled), not the production bundle. Merge-base
`c392669`. Command: `pnpm bench:no-coi-resources --runs 3`, then
`summarize.mjs` over its `results.json`; install/network time excluded.
Sandbox `storage.persistence: 'required'`; Vite `minify: true`.

## Workload

`tools/perf/child-fs/scenario.mjs` tree: React, Gravity UI/icons, date-fns,
Express, Vite 7.3.6, `esbuild@0.28.0` override. Installed 16,836 files /
79,454,021 B (13,464,756 B internal cache); `esbuild.wasm` 13,918,738 B.
First build + two repeats, three native-child commands × three wasm reads,
seven `echo` commands. One warmup pair discarded, three alternating A/B pairs,
fresh Chromium per variant. Lock, wasm and all output hashes identical across
all eight runs; the three output hashes also equal native Node 24.16.0. OPFS
restart kept source and ran a command.

## Two mechanisms, one switch (measured together)

1. **Detached ranges from the owner wrappers**: owner `readFileHead`/
   `readChunk` call an optional `readFileRangeSync` on `InstallClaimFs`/
   `NoCoiProjectFs`; `InstallClaimFs` still reads the whole file from the
   store (`raw.readFileBytesSync(path)`) and returns `slice(offset,
   offset+length)`; `NoCoiProjectFs` forwards. Removes the two full-file
   `.slice()` copies per chunk; a store-level range read was not measured.
   Wire protocol and round-trip count unchanged.
2. **No page-side recovery image on OPFS**: Worker `snapshotFiles()` returns
   no files or directories (no tree walk) when `runtimeBackend === 'opfs'`;
   host `applyRecoveryFsOperation` skips OPFS; dispose drops
   `activation`/`residentRequest`. Memory backend unchanged. OPFS→memory flip
   at restore throws explicitly.

## Medians (3 contexts)

| metric | baseline | prototype | Δ |
|---|---:|---:|---:|
| `echo` completion on installed tree | 968 ms | 0.8 ms | recovery walk removed |
| first `vite build` via SDK, new Worker | 3.047 s | 2.029 s | −33.4% |
| repeat `vite build` via SDK | 2.896 s | 1.839 s | −36.5% |
| Vite-reported build phase | 1.155 s | 1.175 s | none |
| one 13.27 MiB wasm read in native child | 141.9 ms | 41.2 ms | −71% |
| child cmd: startup + 3 reads + hash + recovery | 1.829 s | 0.589 s | −67.8% |
| backing storage after build + GC | 178.93 MiB | 103.18 MiB | −42.3% |
| JS heap after build + GC | 104.70 MiB | 101.05 MiB | −3.5% |
| renderer RSS after build + GC | 1291.52 MiB | 1133.23 MiB | −12.3% |
| sampled max renderer RSS, later build | 1823.08 MiB | 1611.77 MiB | −11.6% |
| sampled max renderer RSS, later read command | 1567.47 MiB | 1314.33 MiB | −16.1% |
| backing storage after dispose, handle retained | 83.02 MiB | 7.29 MiB | −91.2% |

Repeat-build context medians: baseline 2.801–2.903 s; prototype 1.823–1.865 s.

## Attribution

Not isolated by the runner. `echo` performs no reads → its 968 → 0.8 ms is
mechanism 2 alone (per-command tree walk + structured clone of ~79 MB + host
re-copy in `validateActivationState`); the timed wasm read (inside the child)
is mechanism 1 alone. Repeat build gains 1057 ms with Vite's own phase
unchanged: the `echo` gain (967 ms) covers ~91% of it; the ~90 ms rest is
close to one wasm-read gain (~101 ms). No separate per-mechanism build run.

Code-derived cost of mechanism 1 on main (owner store non-forwarding →
`readChunkReplyOf`, `packages/runtime-js/src/ipc/sync-rpc-fs.ts`, full read
per chunk): 13,918,738 B / 256 KiB chunk = 1 `readFileHead` + 53 `readChunk`
= 54 sync XHR round trips (SW route, ADR-0539); each call reads the whole file
and two wrapper layers each `.slice()` it → 108 × 13.27 MiB ≈ 1.4 GiB memcpy
per read. `fs.readSync(fd, …)` in the child
(`packages/runtime-js/src/builtins/fs.ts`) also fetches the whole file per call.

## Limits

Timing runs had no RSS sampler; RSS comes from separate build/read runs,
sampled every 100 ms (may miss peaks); one renderer on a dev host; one
machine; no mobile/production-bundle baseline. Backing storage and heap are
sums over page + owner Worker + Service Worker after forced GC (after dispose:
page + SW); the 42% backing drop is not 42% of RAM — renderer RSS saves
~158 MiB steady / ~211 MiB sampled build max. `persistence: 'required'` → the
OPFS→memory fallback never ran; its equivalence is not established. Remaining
~1.1 GiB RSS includes runtime/native/allocator costs.

## Refine record

2026-10-26 — user fork: OPFS→memory flip at restart without the image = loud
failure (chosen) vs keep image (rejected). `RDY-6` final written-result check
on the three docs: clear after 9 advisory fixes (path, 54 round trips,
DEC-1(3) classification, entry points, core-method rationale).
2026-11-23 — re-verified against main after merge (PR 394): independent
Final+GREEN pass, then cross-review round 1 (0 blocker, 4 should, 7 nit) —
fixed: attribution, run conditions, prototype range-read shape, one-line
Decisions, flip direction, test split.
