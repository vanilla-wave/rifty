# THROWAWAY — no-COI resource experiment

Question: how much RAM and elapsed time do detached range reads and removal of
the duplicate recovery image save in an actual installed Vite/React project?
Experimental branch only; not a production implementation or merge candidate.

Run from the repository root (Chromium + local server + public npm access):

```sh
pnpm bench:no-coi-resources --runs 3 --out /tmp/rifty-no-coi-results
node tools/perf/no-coi-resource-prototype/summarize.mjs /tmp/rifty-no-coi-results/results.json
```

The runner starts/stops its own headerless server on port 5491. Existing listeners
are refused. Each context owns fresh OPFS; no user project/storage is touched.
One warmup pair excluded, then three pairs with alternating order. Each pair
uses a fresh Chromium browser per variant. Install/network time excluded.

## Workload and checks

- Existing `../child-fs/scenario.mjs`: React, Gravity UI/icons, date-fns, Express,
  Vite 7.3.6; `esbuild: 0.28.0` override as the no-COI product carrier.
- Ordinary minified Vite production build, sourcemaps disabled. No generated
  filler files; the read target is the installed upstream `esbuild.wasm`.
- First build and two repeats, three native-child commands with three reads
  each, seven `echo` commands. Measurements retain the actual SDK completion.
- Full resolved lock, installed root versions, upstream WASM SHA-256 and all
  output-file SHA-256 must agree across variants. Actual compiled React UI is
  loaded in Chromium and checked for its visible marker.
- OPFS restart must preserve project source and execute a command. Disposal
  measured with and without the caller retaining the disposed handle.

## Experimental changes

The package-local `no-coi-resource-prototype-worker.ts` sets a realm-local switch
before loading the real toolchain entry;
the page sets the same switch before constructing the SDK. Child Workers keep
the same entry URL/query. Baseline leaves the switch disabled.

1. Claim + project FS wrappers return detached requested ranges. Existing
   binary FS protocol carries total size plus the first chunk, then ranges.
   No write, aliasing, readonly or path policy is bypassed.
2. OPFS recovery uses the persisted tree, omitting the page-side byte image.
   Host mutations do not rebuild that image; disposal drops retained recovery
   references. Memory-backend images remain unchanged.

**Limit:** OPFS is required by the experiment. Experimental OPFS→memory
recovery throws explicitly. The ordinary SDK's fallback promise must be solved
before a production change; no claim of broad SDK equivalence is made here.

## Metrics

Timing runs have no RSS sampler. Separate build/read executions sample one
renderer's RSS every 100 ms; their sampled maximum can miss shorter peaks.
The runner refuses multiple renderers rather than summing shared pages.

Steady retained measurements force GC in page, owner and Service Worker.
V8 `usedSize`, external/backing storage and renderer RSS are separate metrics;
never add RSS to V8 memory. Renderer RSS is not all browser/device memory;
it includes allocator/JIT/native memory and uses a development module host.

Summaries first reduce repeats within one context, then report the median and
range across three independent contexts. First builds mean a new Worker with
dependencies already installed, not a cold device/network.

## Measured result — 2026-10-22

Apple M3 Pro, 12 logical CPUs, 36 GiB RAM; macOS arm64; Chromium
148.0.7778.96; Node 24.16.0. Three measured contexts per variant, after one
discarded pair. All eight contexts passed. Tree: 16,836 files / 79,454,021
bytes including 13,464,756 bytes of internal cache. WASM: 13,918,738 bytes.
This is a small React UI with a substantial real dependency graph, not an
external production repository.

| Median | Baseline | Prototype | Reduction |
|---|---:|---:|---:|
| First build command through SDK, new Worker | 3.047 s | 2.029 s | 33.4% |
| Repeat build command through SDK | 2.896 s | 1.839 s | 36.5% |
| Vite-reported repeat build phase | 1.155 s | 1.175 s | no improvement |
| One installed WASM read in native child | 141.9 ms | 41.2 ms | 71.0% (3.44×) |
| Entire command: child startup + three reads + hashing + recovery | 1.829 s | 0.589 s | 67.8% |
| `echo` completion on installed tree | 968 ms | 0.8 ms | full recovery walk removed |
| Backing storage after build + GC | 178.93 MiB | 103.18 MiB | 42.3% |
| JS heap after build + GC | 104.70 MiB | 101.05 MiB | 3.5% |
| Renderer RSS after build + GC | 1291.52 MiB | 1133.23 MiB | 12.3% |
| Sampled maximum renderer RSS during later build | 1823.08 MiB | 1611.77 MiB | 11.6% |
| Sampled maximum renderer RSS during later read command | 1567.47 MiB | 1314.33 MiB | 16.1% |
| Backing storage after dispose, handle retained | 83.02 MiB | 7.29 MiB | 91.2% |

Repeat-build context medians: baseline 2.801–2.903 s; prototype 1.823–1.865 s.
Post-build RSS: baseline 1279.50–1308.95 MiB; prototype 1127.45–1140.44 MiB.
The 42% backing reduction is **not** a 42% reduction of overall RAM. RSS savings
are about 158 MiB steady / 211 MiB sampled build maximum on this workload.

Outputs, full lockfile and WASM hashes match across all eight runs. Every build
completed successfully; compiled UI rendered the marker. Restart retained the
source and ran a command. The two optimization mechanisms were measured
together; this series does not isolate their individual build-time effects.
Vite's own reported compile phase did not get faster: the substantial command
gain is outside that phase, consistent with eliminating recovery-image work.
Native Node 24.16.0 built the same fixture; all three output hashes match too
([native oracle](results/native-oracle.json)). Its timing is not an A/B metric.

Evidence: [raw JSON, gzip](results/raw.json.gz), [summary](results/summary.json),
[machine](results/host.json), [rendered app](results/app.png),
[measured source hashes](results/measured-sources.json).
`baseRevision` identifies the original HEAD, not the dirty prototype tree.
Hashes were captured before final formatting and moving the experimental Worker
entry beside its owner to obey sealed package boundaries. Runtime behavior is
unchanged; one redundant comment was removed to respect the file-size ceiling.
Source and the complete experiment are retained together on this throwaway branch.
Final relocated entry also passed the full browser workload, rendering and
restart ([verification](results/final-verification.json.gz),
[final source hashes](results/final-sources.json)); excluded from A/B statistics.

Not established: production bundle baseline, mobile-device gains, other guest
workloads, OPFS→memory fallback equivalence. The high remaining renderer RSS
includes runtime/native/allocator costs outside these two changes.
