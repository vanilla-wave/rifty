---
area: npm-client
status: ready
title: Eddy batch asset closure — one immutable bundle GET for the whole shadow-asset set
created: 2026-07-13
why: per-asset fetches scale as n round-trips and skip eddy's shared cache; the asset set is identical for every project on one app version
user_story: As a vite user on an eddy-enabled deployment, I want shadow assets to arrive as fast as my dependencies do, but today the wasm fetch bypasses eddy entirely
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-store]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workspace-content-store.md, docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/adr/npm-client/0194-eddy-v1-2-stateless-bundle-store-shared-resolve-caches-learned-pins.md, docs/adr/npm-client/0195-eddy-wire-protocol-v1-1-get-by-hash-cors-simple-post-streaming-client-prefetch-seam.md]
code: [packages/npm-client/src/eddy-request.ts, packages/npm-client/src/eddy-bundle.ts, packages/npm-client/src/eddy-prefetch.ts]
---

## Context

`ensureShadowAssets` lands with the STD registry transport only. When eddy is
configured, the full asset-pin set (exact versions from the shim registry) can
ride the existing wire protocol as ONE closure — the set is app-version-global,
so the bundle is CDN-hot for every client after the first resolve anywhere.

## Acceptance

- Eddy-configured miss path: `ensureShadowAssets` builds one `EddyRequestBody`
  whose `dependencies` are the exact asset-pin set (e.g. `{"esbuild-wasm":
  "0.28.0"}`) — the SAME body shape installs use; zero eddy server changes
  (prove: no `services/` diff; contract test against the existing wire
  fixtures).
- Learned-pin fast path applies: warm client re-fill = 1 GET, 0 POST (existing
  eddy semantics, asserted the way learned-pin install tests do).
- The asset closure is never merged into a project's install closure: test
  pins that a project's resolve request body and closure hash are byte-equal
  with the asset feature on and off.
- Eddy failure (down, 5xx, stall) → bounded abort (ADR-0201) → STD registry
  fallback with a loud log line; both transports failing → one loud error
  naming both diagnoses.
- Extracted member passes the same final sha256 gate as STD; store write path
  is byte-identical (single ensure owner — no second writer).
- Cold-fill benchmark row (STD vs eddy, same harness as the install ladder)
  recorded in the bench matrix.

## Parity cases

1. Bytes delivered via eddy == bytes via STD == pinned sha256 (three-way
   equality on `esbuild-wasm@0.28.0` member).
2. Learned-pin replay: second client fill = 1 GET / 0 POST.
3. Transient eddy GET failure never overwrites an existing valid store object
   (byte-stability, same invariant as the eddy tarball cache).
4. Partial/truncated bundle → completeness gate declines, store untouched,
   fallback proceeds.

## Fault matrix

| Fault | Outcome |
| --- | --- |
| Eddy unreachable at fill | Bounded abort → STD fallback (loud log), fill succeeds |
| Eddy mid-stream stall | ADR-0201 no-progress abort → STD fallback |
| Truncated/extra-member bundle | Completeness gate declines → fallback; no partial store write |
| Both transports fail | One loud error naming both; consumer action fails named; no retry spin |
| Concurrent fill during eddy stream | Same single-flight owner as STD (no new writer) |

## Out of scope

- Per-asset degenerate closures (n GETs — rejected in ADR-0249 design).
- Merging asset pins into project install closures (pollutes closure hash and
  lockfile).
- Any eddy server/protocol change.
- Prefetching the asset bundle before install starts.

## Decisions

- One batch closure per asset-set, not per asset — round-trips are O(1) in n
  (ADR-0249).
- Fallback order fixed: eddy → STD → loud; never STD → eddy.
- Asset closure requests carry no `overrides` (pins are exact; overrides are a
  project-tree concept).
