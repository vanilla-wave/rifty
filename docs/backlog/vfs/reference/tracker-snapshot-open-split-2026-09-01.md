# Tracker snapshot open/reopen phase split — 2026-09-01

Where the embedder's cold `openProject` time actually goes, measured on
CURRENT main against the real tracker-plugin tree. Answers the open question of
`tracker-embedder-snapshot-facts-2026-09-01.md`: "how much of the 16.3 s is
drain vs decode/parse/apply is unknown until measured on T". Disposable
browser-unit spike; every product-code mark was removed after measurement.

## Headline

- **Current main cannot restore the real asset at all** — two independent
  gates, §Blocker. Timings below use `T'`, the same node_modules payload with
  the two provenance carriers main refuses stripped (§T').
- Cold open on T' is **drain-dominated**: 11.47 s of a 13.37 s end-to-end
  (85.8 %), 91.0 % of `openProject`. Everything non-storage — fetch, sha256,
  JSON, base64 decode, apply, git baseline, TS tools — is 1.10 s together.
- Reopen is drain-free but still storage-dominated: walk 2.24 s +
  preloadContent 6.17 s = **83.9 %** of a 10.03 s reopen.
- The storage-format goal can win this open. Nothing else on the path is
  worth more than ~0.5 s.

## Conditions

- Chromium 148.0.7778.96 / Playwright 1.60.0, headless, COI, real Worker OPFS,
  real service worker, real owner/kernel/node/devServer/typescript workers.
- macOS 26.3.1, arm64, 12 hardware threads, 32 GiB. AC power, battery 100 %
  charged.
- Five samples, median reported. One browser process, one Playwright context;
  cold samples reset the whole origin OPFS first, reopen samples run after a
  `page.reload()` over the OPFS the cold sample left.
- Repo state: `main` at `1a851d7bc`.
- Embedder mimicry: the plan is byte-shaped like tracker4
  `src/ui/Plugins/entities/pluginSandbox/effects.ts` — `kind: 'vite'`,
  `id: 'scratch'`, `starterId`/`templateId: 'tracker-plugin'`, `port: 5173`,
  `firstMaterialization: { kind: 'snapshot', … }`, `storage.persistence:
  'preferred'`, `packageAcquisition.registryUrl: '/npm-registry'` (unreachable
  by design) — and the seed is a verbatim copy of `projectFiles.ts`, `/.gitignore`
  with `node_modules/` included. Verified independently: main's
  `serializePackageJson` + the vite-8 `@napi-rs/wasm-runtime` override
  normalization of that seed reproduces the snapshot's `packageJsonText`
  byte-for-byte.
- Session-ready = `node -e 'console.log(1)'` in the project terminal, exit 0,
  stdout `1` — observed on every one of the 15 opens.

Commands:

```text
pnpm install --frozen-lockfile
SPIKE_SAMPLES=5 npx playwright test --config playwright.browser-unit.config.ts \
  spike-tracker-open.spec.ts --reporter=list
python3 -c "gzip+json of /Users/…/tracker4/static/rifty-snapshots/tracker-plugin.json.gz"
npx tsx .spike-lockcheck.mts     # planShadowSubstitutionsFromLockfile on the real lockfile
```

The spike passed. Product instrumentation, the spike spec/fixtures and both
served snapshot assets were removed before this evidence was recorded.

## Blocker — main refuses the real tracker-plugin asset

The file itself is well-formed for main: `gzip` → 104,785,096 bytes,
`sha256:532d42b7…` = the pinned `snapshotId`, `version: 3`, `templateId:
tracker-plugin`, `packages: 216`, `nodeModules.files: 15,568`,
`tarballCache.files: 1`. `parseDepSnapshot` accepts it. Restore does not:

| gate | where | observed |
|---|---|---|
| install-artifact identity | `package-acquisition-authority.ts` §snapshot admission | `snapshot-rejected:install-artifact-identity-mismatch` — snapshot `sha256:682a1eda…` (baked vs 0.4.0) vs main `sha256:2097074aba…` |
| shadow-substitution catalog | `planShadowSubstitutionsFromLockfile` via `planSnapshotRestore` | `snapshot-rejected:snapshot-restore-plan-failed: EBROKENLOCK: shadow lockfile trace is malformed or unsupported`, cause `TypeError: applied shadow substitution catalog identity drifted` |

Both were observed in the browser, not inferred. The second gate is the
structural one: the lockfile's `appliedShadowSubstitutions` carry the 0.4.0
catalog id/digest and per-recipe digests, and main's builtin catalog moved
(esbuild registry twin, sass facade, emnapi backport). No hash pin makes that
lockfile replayable on main — the asset must be re-baked.

Consequence for the open path with the real asset on main today: acquisition
falls back to `install`, the registry is unreachable, and `openProject`
returns in **295 ms** with NO node_modules — a fast reply that is not the
embedder's project.

## T' — the substrate actually measured

`T'` = the real asset with exactly two carriers replaced, both provenance-only:

- `installArtifactIdentity` re-pinned to main's `sha256:2097074aba…`;
- `lockfile: ''` and `tarballCache.files: []` (main's `planSnapshotRestore`
  explicitly supports the empty-lockfile case: `{lockfileVersion: 3, packages:
  {}}`).

`nodeModules` is byte-identical to the real asset: **15,568 files**,
98,203,932 base64 chars, 73,637,414 logical content bytes, 216 packages,
including the two big wasm blobs. Serialized 99,592,975 bytes (−5.18 MB: the
89 KB lockfile + the 5.10 MB base64 of the single 3.82 MB lightningcss
tarball), gz 24,816,227 bytes, `snapshotId sha256:72f7aaa1…`.

What T' does NOT measure: replay-cache integrity verification of that one
tarball, and the lockfile write. The measured `replay-cache verify` phase is
therefore 0.09 ms instead of one SHA-512 over 3.82 MB (order 10 ms). Nothing
else on the open path differs.

## Cold first open — OPFS reset before every sample

`total` of the drain watermark was **17,218** ops on every sample (15,568
snapshot files + the seed + directories after mkdir-dedup).

| phase | samples ms | median ms | share of e2e |
|---|---|---:|---:|
| fetch + decompress | 153.720, 155.370, 156.265, 153.635, 155.480 | 155.370 | 1.16 % |
| snapshot sha256 (id verify) | 42.535, 43.110, 42.980, 44.775, 43.375 | 43.110 | 0.32 % |
| utf-8 decode | 15.720, 16.875, 16.735, 16.520, 19.350 | 16.735 | 0.13 % |
| `JSON.parse` | 17.290, 14.220, 14.145, 14.335, 16.405 | 14.335 | 0.11 % |
| replay-cache verify | 0.090, 0.085, 0.085, 0.090, 0.100 | 0.090 | 0.00 % |
| prepare import (base64 decode + plan) | 520.085, 512.125, 512.710, 512.515, 512.390 | 512.515 | 3.83 % |
| apply into owner Memory VFS | 340.910, 315.695, 317.120, 338.345, 319.170 | 319.170 | 2.39 % |
| **per-file OPFS drain (flush)** | 11680.265, 11525.685, 11145.950, 11466.195, 11459.205 | **11466.195** | **85.76 %** |
| — first progress event latency | 4.295, 4.910, 5.515, 6.345, 4.285 | 4.910 | — |
| — first → terminal (17218/17218) | 11675.910, 11520.700, 11140.360, 11459.775, 11454.830 | 11459.775 | — |
| stamp promotion → package-tree publish | 0.020, 0.020, 0.020, 0.025, 0.030 | 0.020 | 0.00 % |
| git baseline (`ensureStarterInitialCommit`) | 19.760, 19.250, 19.415, 19.470, 20.595 | 19.470 | 0.15 % |
| session tools (TS worker + SCM) | 26.105, 26.685, 25.870, 25.855, 27.305 | 26.105 | 0.20 % |
| Workbench boot (fleet + SW + lock, empty OPFS) | 193.410, 179.895, 182.765, 183.780, 180.975 | 182.765 | 1.37 % |
| catalog `createScratch` | 30.875, 26.730, 28.450, 28.960, 28.745 | 28.745 | 0.22 % |
| session-ready (`node -e`, after open) | 653.110, 544.455, 548.045, 550.145, 568.275 | 550.145 | 4.11 % |

Roll-ups (medians, same samples):

| roll-up | samples ms | median ms |
|---|---|---:|
| acquisition (fetch → promotion) | 12777.710, 12590.200, 12213.240, 12553.430, 12533.190 | 12553.430 |
| `createProject` (composition + git + tools) | 46.600, 46.650, 46.005, 46.040, 48.630 | 46.600 |
| `openProject` resolve | 12831.110, 12641.365, 12263.835, 12604.040, 12586.705 | 12604.040 |
| whole session-ready (end-to-end) | 13711.080, 13395.200, 13025.830, 13369.730, 13367.400 | 13369.730 |

Accounting: the 12 phases above sum to 13,334.660 ms of the 13,369.730 ms
end-to-end — **35.07 ms (0.26 %) unaccounted** (host-assets module import,
mark-to-mark gaps inside acquisition, controller reply hop). Inside
`openProject`: acquisition + `createProject` = 12,600.030 of 12,604.040 →
4.01 ms unaccounted. Inside acquisition the nine phases sum to 12,527.540 of
12,553.430 → 25.89 ms unaccounted.

Rates: **0.737 ms per snapshot file**, 0.666 ms per drain op. The projection in
`tracker-embedder-snapshot-facts` (7.72 s from the C-series 0.496 ms/file) is
**1.49× optimistic** against main's real drain on the real tree.

## Warm reopen — same OPFS, fresh page realm

Two variants, because they differ by 4×.

**A. Reopen only** (`playground.define` + `openProject`, no catalog mutation):

| phase | samples ms | median ms | share |
|---|---|---:|---:|
| `refreshIndex` / `walkOpfsTree` (17,354 entries) | 2239.090, 2275.895, 2240.650, 2209.530, 2129.410 | 2239.090 | 22.33 % |
| `preloadContent` | 6257.085, 6171.330, 6302.700, 5841.660, 5713.060 | 6171.330 | 61.53 % |
| rest of Workbench boot (fleet, SW, lock, catalog load) | — (derived) | 1016.265 | 10.13 % |
| owner acquisition (stamp hit, no snapshot fetch) | 0.785, 0.770, 0.775, 0.775, 0.760 | 0.775 | 0.01 % |
| `createProject` — git baseline | 1.320, 1.270, 1.280, 1.325, 1.285 | 1.285 | 0.01 % |
| `createProject` — session tools | 10.270, 10.265, 10.170, 10.230, 10.180 | 10.230 | 0.10 % |
| `openProject` resolve | 18.210, 18.030, 17.960, 18.100, 17.970 | 18.030 | 0.18 % |
| session-ready (`node -e`) | 554.235, 559.055, 547.750, 554.275, 519.930 | 554.235 | 5.53 % |
| whole reopen end-to-end | 10073.200, 10029.455, 10147.350, 9561.410, 9377.585 | 10029.455 | 100 % |

Sum of parts 9,999.885 → **29.57 ms (0.29 %) unaccounted**. Walk + preload own
**83.9 %**; `openProject` itself is 18 ms — owner assignment and git are noise.
Measured reopen 10.03 s vs the C-series projection 4.95 s: **2.03×**
optimistic, and the gap is entirely `preloadContent` (6.17 s here vs a
projected ~2.9 s) plus the ~1.0 s worker-fleet boot the benchmarks never
included.

**B. The embedder's own sequence** (`createScratch({preserveDirtySameStarter:
true})` on every open, as `openProjectFx` does) over a CLEAN scratch:

| phase | samples ms | median ms | share |
|---|---|---:|---:|
| Workbench boot (walk 2231.975 + preload 5870.645 + 987.865) | 9532.535, 9527.810, 9090.615, 9031.350, 8908.995 | 9090.615 | 22.34 % |
| `createScratch` — scratch RESET (erase 17k persisted files, re-stage seed) | 19166.485, 17424.645, 18595.635, 18535.535, 19035.185 | 18595.635 | 45.70 % |
| `openProject` — full re-fetch + re-restore + re-drain (11018.905) | 11833.935, 13974.560, 12030.795, 12246.980, 12164.875 | 12164.875 | 29.90 % |
| session-ready | 544.650, 558.625, 567.425, 537.515, 553.315 | 553.315 | 1.36 % |
| end-to-end | 41104.770, 41492.730, 40315.715, 40385.100, 40690.535 | 40690.535 | 100 % |

Sum 40,404.440 → 286.10 ms (0.70 %) unaccounted. A clean scratch is not
preserved by `preserveDirtySameStarter`, so the embedder's reopen erases the
whole persisted tree and materializes it again: **40.7 s, worse than its cold
open**. This is a product finding independent of the storage format — it is
why "reopen was never timed by the embedder" is not the whole story.

## Memory / storage

- OPFS on disk after a cold open: `navigator.storage.estimate()` →
  `usage 76,752,082` of `quota 6,519,203,026` (73.6 MB logical + ~4 %).
- `navigator.storage.persisted()` = **false** under `persistence: 'preferred'`
  in headless Chromium — no user engagement signal to grant it.
- Owner-realm heap NOT obtained: the owner worker is nested inside the kernel
  worker, so `page.workers()` exposes only
  `kernel-worker-entry.ts` and there is no CDP target to attach to.
  Page-realm `Runtime.getHeapUsage` after `HeapProfiler.collectGarbage` is
  1.14 MB used / 2.36 MB total — the page holds none of the tree, so the number
  is not the figure of interest. `performance.measureUserAgentSpecificMemory`
  throws (known).

## Honest limits

1. **T', not T.** The real asset does not restore on main at all (§Blocker).
   T' drops 5.18 MB of provenance payload and one 3.82 MB integrity check.
   Byte-linear phases (base64 decode, JSON, sha256) are therefore ~5 % low;
   the drain and the file-linear phases are exact.
2. **Localhost asset.** Vite dev served the `.gz` with `Content-Encoding:
   gzip`, so the browser decompressed it and `fetch + decompress` = 155 ms is a
   loopback number with no CDN RTT and no cold TCP/TLS. The embedder fetches
   28.5 MB over a real network; that phase is a floor, not the embedder's cost.
3. **16.3 s not reproduced as such.** Measured cold `openProject` = 12.60 s
   (13.37 s to a usable Node session) against the embedder's reported 16.3 s on
   `@riftydev/workbench` 0.4.0. Differences that plausibly cover the 3.7 s:
   0.4.0 vs main (mkdir-dedup and drain scheduling moved), real-network asset
   fetch, a live tracker page competing for main thread and CPU, and T'
   dropping the replay-cache verification. Same order, same shape — the split
   below is what matters, not the absolute.
4. **Headless, one machine, no OS cache eviction.** OPFS was reset per cold
   sample; the OS page cache stayed warm and uncontrolled, as in the C-series.
5. The `reopen-embedder` 40.7 s is for a CLEAN scratch. A dirty scratch (the
   normal case after the user edits a file) takes the preserve path and should
   land near variant A; that was not measured.

## Decision evidence

- Storage owns the open: **85.8 %** of a cold open end-to-end and **83.9 %** of
  a reopen. Every non-storage phase on the cold path put together — fetch,
  sha256, utf-8 decode, `JSON.parse`, base64 decode, apply, git baseline, TS
  tools, workbench boot, catalog — is **1,097 ms**, 8.2 %.
- A storage format that made persistence O(bytes) instead of O(files) is
  therefore the only change that can move this open. The journal candidate's
  measured append rate (85.5 MB/s, `storage-journal-design-benchmarks`) puts
  73.6 MB at ~0.86 s against today's 11.47 s.
- The two encoding taxes the playground backlog tracks (base64 double-carry,
  JSON) cost 0.51 s + 0.03 s here — real, but 4 % of the open. They are not
  the win.
- Both cold projections in `tracker-embedder-snapshot-facts` are optimistic on
  main: drain 1.49×, reopen 2.03×. Any budget built on them under-states the
  work by ~4 s cold and ~5 s reopen.
- Before ANY of this reaches the embedder, the snapshot must be re-baked
  against main: the shipped 0.4.0 asset is unrestorable on main at the shadow
  catalog gate, and no configuration flips that.
