# PR 384 no-COI resource prototype — durable record (2026-10-26)

Provenance: throwaway branch `prototype/no-coi-resource-economy`, commit
`1f0cd3a0d`, PR https://github.com/vanilla-wave/rifty/pull/384 (open, never a
merge candidate). Branch artifacts rot; load-bearing numbers inlined here.
Full raw/summary/host JSON + rendered app: `tools/perf/no-coi-resource-prototype/`
on that branch. Re-verify against current main before building on it.

Environment: Apple M3 Pro, 36 GiB; macOS arm64; Chromium 148.0.7778.96;
Node 24.16.0; dev module host (unbundled), not the production bundle.
Merge-base `c392669`.

## Workload

`tools/perf/child-fs/scenario.mjs` tree: React, Gravity UI/icons, date-fns,
Express, Vite 7.3.6, `esbuild@0.28.0` override. Installed 16,836 files /
79,454,021 B (13,464,756 B internal cache); `esbuild.wasm` 13,918,738 B.
First build + two repeats, three native-child commands × three wasm reads,
seven `echo` commands. One warmup pair discarded, three alternating A/B pairs,
fresh Chromium per variant. Lock, wasm and all output hashes identical across
all eight runs; the three output hashes also equal native Node 24.16.0. OPFS restart kept source and
ran a command.

## Two mechanisms, one switch (measured together)

1. **Range reads**: owner `readFileHead`/`readChunk` serve the requested
   range through an optional `readFileRangeSync` on the two owner wrappers
   (`InstallClaimFs`, `NoCoiProjectFs`) instead of `readFileBytesSync(path)`
   + full `.slice()` per layer per chunk. Wire protocol unchanged.
2. **No page-side recovery image on OPFS**: Worker `snapshotFiles()` returns
   no files when `runtimeBackend === 'opfs'`; host `applyRecoveryFsOperation`
   skips OPFS; dispose drops `activation`/`residentRequest`. Memory backend
   unchanged. OPFS→memory flip at restore throws explicitly.

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

Not isolated by the runner, but separable by workload: `echo` performs no
reads → its 968 → 0.8 ms is mechanism 2 alone (per-command tree walk +
structured clone of ~79 MB + host re-copy in `validateActivationState`);
the wasm read is mechanism 1 alone. Vite's own phase unchanged → the ~1 s
command gain is outside compilation, i.e. mechanism 2.

Code-derived cost of mechanism 1 on main: 13,918,738 B / 256 KiB chunk =
1 `readFileHead` + 53 `readChunk` = 54 sync XHR round trips (SW route,
ADR-0539); each call reads the whole file and two wrapper layers each
`.slice()` it → 108 × 13.27 MiB ≈ 1.4 GiB memcpy per read. `fs.readSync(fd, …)` in the child
(`packages/runtime-js/src/builtins/fs.ts`) also fetches the whole file per call.

## Limits

RSS sampled every 100 ms (may miss peaks); one renderer on a dev host; one
machine; no mobile/production-bundle baseline; OPFS→memory fallback
equivalence not established. Remaining ~1.1 GiB RSS is runtime/native/
allocator, outside both mechanisms.

## Refine record

2026-10-26 — user fork: OPFS→memory flip at restart without the image = loud
failure (chosen) vs keep image (rejected). `RDY-6` final written-result check
on the three docs: clear after 9 advisory fixes (path, 54 round trips,
DEC-1(3) classification, entry points, core-method rationale).
