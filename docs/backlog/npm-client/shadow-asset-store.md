---
area: npm-client
status: ready
title: Shadow asset store — declared pins, install-time fill, workspace CAS, bundle asset removed
created: 2026-07-13
why: executed esbuild.wasm bytes ship as an app-bundle asset outside npm provenance and re-download on HTTP-cache eviction
user_story: As a vite user, I want esbuild's wasm delivered by install with npm-grade integrity and offline durability, but today it arrives as a 13.3MB app asset the browser may evict
epic: honest-shadow-substitutions
blocked_by: []
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workspace-content-store.md, docs/adr/npm-client/0201-bounded-fetch-chokepoint-no-progress-stall-bounds-on-all-npm-client-fetches.md, docs/adr/playground/0241-install-artifact-identity-for-dependency-trees.md, docs/adr/toolchain-build/0226-upstream-derived-filesystem-enabled-esbuild-runtime.md]
code: [packages/npm-client/src/fetch-and-unpack.ts, packages/npm-client/src/tarball-cache.ts, packages/npm-client/src/shadow-shims.ts, tools/shadow-registry/src/index.ts, tools/shadow-registry/esbuild-runtime-policy.json, apps/playground/src/workers/vite-esbuild-runtime.ts, tools/shadow-registry/src/install-artifact-recipe.ts]
---

## Context

ADR-0249 records the decision; this item is the build contract. Today
`vite-esbuild-runtime.ts:3` imports `esbuild-wasm/esbuild.wasm?url` from the
app bundle; the shim registry declares no assets; the store does not exist.

## Acceptance

- `internalsShims` entries accept `assets: [{tarball {name, version,
  integrity}, member, sha256}]`; the esbuild entry's pin is generated from
  `esbuild-runtime-policy.json` (new `wasm.tarball` fields), and
  `check:esbuild-runtime-drift` fails on pin drift between policy and registry.
- `ensureShadowAssets(pins)` in npm-client: store hit → zero network; miss →
  `fetchAndUnpack` (tarball-cache + SRI + ADR-0201 bounds) → extract `member` →
  member sha256 must equal the pin → temp-write + atomic rename to
  `/.rifty/shadow-assets/sha256/<hex>`. Reads re-verify sha256 (tarball-cache
  pattern); in-page fills are single-flighted per hash.
- `install()` applying a shim with assets starts the fill; fill failure is
  reported loud and does NOT gate the install stamp (prove with the
  foreign-path fault test).
- `prepareViteEsbuildRuntime` consumes the store through its guest `FsSync`;
  the `?url` bundle import is deleted.
- Asset pins join `install-artifact-recipe`: changing a pin changes
  `installArtifactIdentity` (test: old identity → re-arrival, per ADR-0241).
- Behavioral proof, not grep: browser e2e — after install completes, block all
  network, run `vite build` → succeeds from the store; then clear the store,
  keep network blocked, re-run → loud error naming `esbuild.wasm`. RED first:
  delete the bundle asset without the store → the same e2e must fail loud.

## Parity cases

1. Tarball SRI mismatch on the network path → `EINTEGRITY` with the same error
   shape `fetchAndUnpack` throws for dependency tarballs (one chokepoint, not a
   parallel error family).
2. Member sha256 mismatch after a clean tarball → loud named error, store NOT
   written, tarball-cache still keeps the (valid) tarball.
3. Corrupt store object on read → treated as miss exactly like tarball-cache
   lookup corruption (delete + single refetch; second mismatch → loud
   `EINTEGRITY`).
4. `esbuild-wasm@0.28.0` member bytes fetched via this path are byte-identical
   to the previously bundled asset (sha256
   `9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b`).

## Fault matrix

| Fault | Outcome |
| --- | --- |
| Crash between temp write and rename | Orphan temp invisible to reads; next ensure treats as miss, refetches; orphans swept on successful ensure |
| Corrupt object in store (bit rot, partial write) | Read re-verify → delete + one refetch; refetch mismatch → loud EINTEGRITY, no retry loop |
| Quota/persist failure during fill | Loud errno from ensure; consumer action fails named; install stamp intact (foreign path, ADR-0241 scoping) |
| Two concurrent ensures, same hash (two vite children) | Single-flight: one network fetch, both consumers get bytes |
| Cross-tab concurrent fill | Content addressing → identical bytes; atomic rename; read re-verify tolerates; full multi-tab serialization out of scope (recorded gap) |
| Network down + store miss | Loud error naming asset and transport; no silent retry spin |
| App update changes pin | New sha256 = new key = honest miss; non-pinned objects swept on successful ensure |
| User deletes `/.rifty/shadow-assets` mid-session | Next consumption lazily refetches (miss path); no stamp revocation |

Shared mutable state: store objects under `/.rifty/shadow-assets/sha256/<hex>`.
Writers: (1) install-time fill, (2) lazy consumption fill — both call the ONE
`ensureShadowAssets` owner which serializes per hash in-page; cross-tab writers
are unserialized by design and safe only because objects are content-addressed
and reads re-verify.

## Out of scope

- Global cross-workspace store — blocked on the multi-tab story; workspace
  duplication accepted (ADR-0249).
- Relocating the derived esbuild runtime JS out of the app bundle.
- Retiring the `@esbuild/wasi-preview1` alias override
  (`npm-client/esbuild-alias-override-retirement`).
- Eddy transport (`npm-client/eddy-batch-asset-closure`).
- Cross-worker `WebAssembly.Module` sharing (perf follow-up; measure first).
- Auto-bumping upstream pins.

## Decisions

- Pins live on the shim entry; esbuild's is generated from the runtime policy —
  one source of truth (ADR-0249).
- Store key = content sha256, not name@version: version skew unrepresentable.
- Fill never gates the install stamp; consumers fail loud instead (ADR-0249,
  ADR-0241 foreign-path scoping).
- Snapshots do not carry store objects; instant-preset restore starts a
  background ensure (cold cost ≤ today's on-action fetch).
- Transport is untrusted in every variant; member sha256 gate is final.
