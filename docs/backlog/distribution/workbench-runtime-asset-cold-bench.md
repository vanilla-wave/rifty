---
area: distribution
status: ready
title: Workbench runtime-asset cold benchmark — exact STD fill cost and Eddy baseline
created: 2026-07-17
why: cold standard install adds a serial 13,918,738-byte runtime-asset fill, but its user-visible wall time and response bytes are not recorded under a reproducible boundary
user_story: As a Workbench operator, I want a truthful cold STD runtime-asset baseline so I can budget first-run latency and compare Eddy against the identical verified work.
epic: honest-shadow-substitutions
blocked_by: [distribution/workbench-runtime-asset-cutover, npm-client/esbuild-alias-override-retirement]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/npm-client/0201-bounded-fetch-chokepoint-no-progress-stall-bounds-on-all-npm-client-fetches.md, docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/adr/npm-client/0194-eddy-v1-2-stateless-bundle-store-shared-resolve-caches-learned-pins.md]
code: [tools/perf/bench.mjs, tools/perf/src/aggregate.mjs, tools/perf/src/aggregate.test.ts, tests/integration/fixtures/workbench-vite-consumer, perf/benchmarks.json]
---

## Context

The cutover item proves that real Vite 7 consumes verified bytes and that Vite
8 needs none. This item makes no functional claim and changes no production
runtime. It adds one reproducible measurement phase to the existing real-
Chromium harness and commits the standard-registry cost that Eddy must later
match.

The measured unit is the post-tree runtime-asset fill, not the dependency-tree
install, full project open, Vite boot, or preview readiness. The source remains
the standard validating registry path under ADR-0201. A partial median, mixed
cache regime, inferred transport, or successful Vite run without phase proof is
`unmeasured`, never a number.

## Acceptance

### Contract + RED

- First checkpoint adds failing CLI validation, exact phase-boundary capture,
  five-run evidence aggregation, schema-v3, and whole-row refusal tests before
  recording or changing the benchmark artifact.
- RED proves the current harness cannot isolate and attest the STD asset fill or
  encode its seconds/response bytes. A successful Vite run or partial median is
  not measurement evidence.

### Final + GREEN

- Implement the harness and aggregator below, then commit one real measured
  five-run STD row. Schema/runtime paths may emit `unmeasured` for invalid
  evidence, but an `unmeasured` artifact does not close this item.
- One committed SHA reproduces the row, passes focused aggregator/harness tests
  and `pnpm pr:check`, and has zero Final+GREEN correctness blockers.

### Exact harness invocation and scenario

- Add `--shadow-asset-cold off|standard` to `tools/perf/bench.mjs`; default is
  `off` so existing invocations retain their phases. `standard` requires
  `VITE_RIFTY_REGISTRY_URL`, deletes inherited
  `VITE_RIFTY_RESOLVER_URL` and `VITE_RIFTY_EDDY_BUNDLE_URL` before starting
  the measured host, and rejects incompatible/missing arguments before opening
  Chromium.
- The committed baseline is produced with exactly:

  ~~~text
  node tools/perf/bench.mjs --runs 5 --transport auto \
    --shadow-asset-cold standard --out perf/benchmarks.json
  ~~~

  `VITE_RIFTY_REGISTRY_URL` is supplied by the environment per D-004. The
  artifact records its exact URL; no registry or proxy URL is hardcoded.
- Reuse the controller item's packed external host at
  `tests/integration/fixtures/workbench-vite-consumer`; its measurement route
  imports only the generic public Workbench root and published worker subpaths.
  It opens
  `projects.vite({id:'shadow-asset-cold',viteVersion:'7.3.6',...})` with the
  fixed minimal Vite fixture, `storage.persistence:'preferred'`, registry-only
  package acquisition, and `onRuntimeAssetProgress`. It does not use the
  Playground companion, a private owner handle, or an alternate manager seam.
- Perform one discarded warm-up in its own Chromium context before measurement.
  It warms the dev server/proxy/origin only; its profile, storage, service
  worker, HTTP cache, and Workbench are closed and never reused by a measured
  run.
- Run exactly five measured iterations. Each creates a fresh Chromium context,
  opens one fresh Workbench/project, settles the operation, closes project and
  Workbench, proves the origin Web Lock can be reacquired, then closes the
  context. No context, Workbench, project id state, OPFS namespace, browser HTTP
  cache, or manager survives into the next iteration.

### Measurement boundary and proof

- In each measured context, `workbench.runtimeAssets.inspect()` before project
  open must report zero semantic entries, zero verified objects/bytes, and zero
  ready sets. Non-zero state refuses the run.
- Capture progress for the one open operation. It must be one owner-ordered
  sequence for the expected one-asset plan:
  `cache-check -> fetch -> verify -> persist? -> ready`. Start the sample on
  synchronous delivery of its first `cache-check`; stop on synchronous delivery
  of `ready`, whose pointer/storage acknowledgement is already complete. Both
  timestamps use the harness page's single monotonic `performance.now()` clock.
  Missing, duplicate, late, interleaved, wrong-asset, or out-of-order progress
  refuses the complete row.
- The terminal `ready` progress must carry the expected required-set digest,
  `assetCount=1`, and the actual storage class. All five runs must report one
  identical digest and storage class. After open, semantic inspection must show
  one valid ready set and exactly one verified object of `13,918,738` bytes.
- Network/CDP evidence must identify the exact `esbuild-wasm@0.28.0` standard
  packument and tarball responses for each iteration. The registry response and
  ready facts together must prove `fillTransport='standard'` and
  `fillCache='network'`; a tarball hit, Eddy request/fallback, missing response,
  retry without complete accounting, or mixed source refuses the row.
- For each run record decoded packument body bytes, tarball response-body bytes,
  and total response-body bytes for every asset-source response, including
  redirects/retries. `total` is the sum of the recorded asset-source response
  bodies and cannot be inferred from `Content-Length`. CDP body/protocol evidence
  absent due to eviction, redirect ambiguity, or collection failure refuses the
  row.
- `--transport auto` records per-run positive CDP protocol evidence and request
  counts for every used remote origin. A used origin without a known positive
  protocol refuses the row. The warm-up has separate evidence and contributes
  neither samples nor bytes.
- Close and Web-Lock reacquisition occur outside the timed window but are
  mandatory validity proof. Any close, cleanup, or reacquisition failure makes
  the entire standard row `unmeasured`.

### Perf schema v3

- Increment `schemaVersion` from 2 to 3 without changing the meaning or shape of
  existing metrics. Schema v3 always contains
  `metrics.shadowAssetColdFillMs.standard` as exactly one of:

  ~~~ts
  type ShadowAssetColdUnmeasured = Readonly<{
    status: 'unmeasured'
    note: string
  }>

  type ShadowAssetColdRun = Readonly<{
    durationMs: number
    requiredSetDigest: string
    storageClass: 'opfs-persisted' | 'opfs-best-effort' | 'memory-session'
    fillTransport: 'standard'
    fillCache: 'network'
    memberBytes: 13918738
    responseBodyBytes: Readonly<{
      packumentDecoded: number
      tarball: number
      total: number
    }>
    transport: Readonly<{
      mode: 'auto'
      origins: Readonly<Record<string, Readonly<{
        protocol: string
        requests: number
      }>>>
    }>
  }>

  type ShadowAssetColdMeasured = Readonly<{
    status: 'measured'
    count: 5
    samples: readonly [number, number, number, number, number]
    median: number
    displayMs: number
    requiredSetDigest: string
    storageClass: ShadowAssetColdRun['storageClass']
    fillTransport: 'standard'
    fillCache: 'network'
    memberBytes: 13918738
    registryUrl: string
    cacheRegime: 'fresh-context-empty-store-and-tarball;warm-proxy-origin'
    runs: readonly [
      ShadowAssetColdRun,
      ShadowAssetColdRun,
      ShadowAssetColdRun,
      ShadowAssetColdRun,
      ShadowAssetColdRun,
    ]
  }>
  ~~~

  `samples[i] === runs[i].durationMs`. `median` uses the existing exact median;
  `displayMs` uses the existing conservative upward rounding. Byte counts are
  non-negative safe integers and `total >= packumentDecoded + tarball`.
- The metric container reserves optional `eddy` with the same measured/
  unmeasured row shape plus truthful Eddy transport/cache fields, and optional
  `speedupX`. This item writes only `standard`. The Eddy batch item may add
  `eddy` and computes `speedupX = standard.median / eddy.median` only when both
  complete matched rows are measured.
- `buildArtifact` never derives a measured row from fewer than five valid runs.
  Any invariant failure emits only `{status:'unmeasured',note}` for `standard`;
  partial samples and a partial median never enter the committed artifact.
- Aggregator unit tests pin schema migration, exact five-run median/rounding,
  sample-to-run equality, safe-integer byte checks, digest/storage/cache
  uniformity, missing/mixed evidence refusal, and the future rule that
  `speedupX` is absent unless two matched measured rows exist.
- Commit one real measured STD row to `perf/benchmarks.json`. If a run cannot
  produce all required proof, it writes `unmeasured` with the exact reason and
  leaves this item open; never retain a stale v2 artifact or fabricate evidence.

## Parity cases

1. This item introduces no Node-visible behavior. Its fixture must first pass
   the cutover item's real Vite 7 functional journey on the same SHA; a failed
   run is measurement-invalid rather than a benchmark result.
2. The measured member size and required-set digest equal the canonical
   esbuild descriptor/plan facts used by the manager and cutover; the harness
   never reconstructs either from response size or package name alone.
3. Aggregator reference vectors prove exact median, conservative display
   rounding, per-run byte sums, and whole-row refusal for four-of-five or mixed
   evidence.
4. Replaying the five raw duration values through the pure aggregator produces
   byte-identical `samples`, `median`, and `displayMs` fields in the committed
   artifact.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `provenance-lie` | Resolver/bundle env leaks into STD host | reject before browser; no measured row |
| `provenance-lie` | Tarball cache hit or source transport is ambiguous | whole standard row `unmeasured` |
| `provenance-lie` | Required-set digest/member size inferred from URL/count | refuse; compare canonical progress/inspection facts |
| `observable-order` | Missing/duplicate/interleaved/out-of-order phase | whole standard row `unmeasured`; no inferred timestamps |
| `lossy-aggregate` | Four successes and one failure | no partial median; unmeasured with exact reason |
| `lossy-aggregate` | Storage class/digest/cache regime differs across runs | no mixed median; whole row unmeasured |
| `unbounded-read` | Packument/tarball stalls | ADR-0201 bounded failure; row unmeasured, harness settles |
| `corrupt-input` | CDP body length, byte sum, or safe-integer check fails | row unmeasured; no Content-Length substitution |
| `false-fallback` | Eddy request/fallback appears in STD run | row unmeasured; receipt/network facts remain truthful |
| `torn-state` | Context/Workbench close or lock release fails | row unmeasured; next run cannot reuse the context |
| `poisoned-cache` | Warm-up profile/store is reused | pre-open zero proof fails; row unmeasured |
| `sibling-drift` | Artifact and aggregator disagree on schema v3 | schema fixture fails; no write of malformed artifact |

## Out of scope

- Vite functionality, runtime-reader correctness, host-asset removal, storage
  semantics, acquisition ordering, and public Workbench behavior; their ready
  items own functional acceptance.
- Eddy implementation or an Eddy performance claim. The Eddy batch item must
  add a matched row using this exact asset set, boundary, five-context regime,
  storage class, cache/origin regime, and transport mode.
- h2-versus-h3 comparative claims; the committed baseline is production
  `auto`. Existing transport-matrix work retains ownership of protocol
  comparisons.
- Alternative Vite/esbuild versions, multiple assets, warm cache fills,
  reload/offline fills, non-Chromium browsers, UI timing, and full
  install-to-preview timing.
- A pass/fail latency budget or optimization. This item records the truthful
  baseline; changing runtime behavior requires a separate contract.

## Decisions

- Measure only owner-ordered `cache-check` through acknowledged `ready` inside
  generic `openProject`; exclude dependency-tree install and Vite startup.
- One discarded warm-up plus five isolated Chromium contexts is the fixed STD
  regime. The proxy/origin may be warm; every browser/store/tarball cache is
  cold and proven.
- Schema v3 preserves raw per-run durations, bytes, and transport evidence.
  Missing or mixed proof degrades the complete row to `unmeasured`.
- The standard row is the immutable comparison boundary. Eddy may add only a
  matched row and may not redefine timing, asset set, contexts, or cache regime.
- Measurement changes no public or owner protocol and cannot close functional
  acceptance for the cutover.
