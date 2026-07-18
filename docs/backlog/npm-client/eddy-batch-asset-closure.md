---
area: npm-client
status: ready
title: Eddy batch asset closure — one immutable bundle GET for the exact missing asset set
created: 2026-07-13
why: per-asset fetches scale as n round-trips and skip eddy's shared cache; one ensure can batch its exact missing source packages
user_story: As a vite user on an eddy-enabled deployment, I want shadow assets to arrive as fast as my dependencies do, but today the wasm fetch bypasses eddy entirely
epic: honest-shadow-substitutions
blocked_by: [distribution/workbench-runtime-asset-cold-bench]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/adr/npm-client/0194-eddy-v1-2-stateless-bundle-store-shared-resolve-caches-learned-pins.md, docs/adr/npm-client/0195-eddy-wire-protocol-v1-1-get-by-hash-cors-simple-post-streaming-client-prefetch-seam.md]
code: [packages/npm-client/src/eddy-request.ts, packages/npm-client/src/eddy-bundle.ts, packages/npm-client/src/eddy-prefetch.ts, tools/perf/bench.mjs, tools/perf/src/aggregate.mjs, tools/perf/src/aggregate.test.ts, perf/benchmarks.json]
---

## Context

`ShadowAssetManager` lands with the STD registry adapter only. When eddy is
configured, one ensure can send the exact de-duplicated source package set for
its verified misses through the existing wire protocol as one closure. Store
hits never enter either transport.

## Acceptance

- Manager verifies every object before transport selection; zero misses means
  zero Eddy/STD requests.
- Eddy miss path builds one canonical `EddyRequestBody` whose dependencies are
  the sorted, de-duplicated exact source packages for the missing descriptors
  (e.g. `{"esbuild-wasm":"0.28.0"}`) — the SAME body shape installs use;
  zero server changes (existing wire fixtures prove it).
- Composed-registry construction rejects an asset source package/version that
  matches any baked override or shadow trigger as `ESHADOWASSETSOURCE`. Without
  this invariant Eddy's ordinary `install()` resolver could substitute the
  source. Test proves rejection happens before POST/GET.
- The owner manager owns learned-pin state; its key derives from the canonical
  request body. Warm re-fill of the same missing set = 1 GET, 0 POST.
- The asset closure is never merged into a project's install closure: test
  pins that a project's resolve request body and closure hash are byte-equal
  with the asset feature on and off.
- Eddy failure (down, 5xx, stall) → bounded abort (ADR-0201) → STD registry
  fallback with a loud log line; both transports failing → one loud error
  naming both diagnoses.
- Every required member passes the manager's path/type/size/decompression/hash
  gates; no readiness receipt publishes until the whole required set validates.
- STD and Eddy share the one manager writer and produce byte-identical objects;
  receipts differ only in truthful transport/cache fields.
- Extend the Workbench cold-bench item's committed
  `shadowAssetColdFillMs.standard` record with
  a matched `eddy` row; preserve STD verbatim. Use the same phase boundary,
  asset set, five fresh Chromium contexts, storage class, client/origin cache
  regime, `--transport` HTTP mode, and protocol-proof rules; start with empty
  learned-pin state. Every run proves receipt `fillTransport=eddy`; fallback to
  STD or any incomplete/mixed proof records Eddy `unmeasured`. Record Eddy
  bundle response-body bytes separately and compute
  `speedupX = standard.median / eddy.median` only when both complete rows are
  measured.

## Parity cases

1. Bytes delivered via eddy == bytes via STD == pinned sha256 (three-way
   equality on `esbuild-wasm@0.28.0` member).
2. Learned-pin replay: second fill of the same canonical missing set = 1 GET /
   0 POST; a different set never reuses its key.
3. Transient eddy GET failure never overwrites an existing valid store object
   (byte-stability, same invariant as the eddy tarball cache).
4. Partial/truncated bundle → completeness gate declines, no receipt
   publishes, STD fallback proceeds.

## Fault matrix

| Axis | Fault | Outcome |
| --- | --- | --- |
| `false-fallback` | Eddy unreachable at fill | Bounded abort → STD fallback (loud log), fill succeeds |
| `unbounded-read` | Eddy mid-stream stall/oversize | ADR-0201 abort/cap → STD fallback |
| `corrupt-input` | Truncated/extra-member bundle | Completeness gate declines → fallback; no receipt publishes |
| `false-fallback` | Both transports fail | One loud error naming both; no retry spin |
| `concurrent-same-key` | Install/child fill during Eddy stream | Manager single-flight per hash; no second writer |
| `provenance-lie` | Eddy falls back to STD | Receipt records STD/cache result, never planned Eddy |
| `poisoned-cache` | Missing-set request changes | Canonical body selects a different learned-pin key |
| `false-fallback` | Source package matches override/trigger | Construction fails `ESHADOWASSETSOURCE`; zero Eddy/STD request; no accidental substitute bytes |

## Out of scope

- App-global/full-catalog asset closures; only the exact missing applied set is
  requested.
- Merging asset pins into project install closures (pollutes closure hash and
  lockfile).
- Any eddy server/protocol change.
- Raw-source resolver mode that bypasses baked overrides/shims.
- Prefetching the asset bundle before install starts.

## Decisions

- One batch closure per canonical missing set; a one-asset set is valid.
- Fallback order fixed: eddy → STD → loud; never STD → eddy.
- Asset closure requests carry no `overrides` only because source descriptors
  cannot match builtins/triggers. Supporting such a source requires a new Eddy
  raw-source protocol decision.
