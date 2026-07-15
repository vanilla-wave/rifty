---
area: npm-client
status: ready
title: ShadowAssetManager — verified store, STD transport, receipts, install outcome
created: 2026-07-15
why: an exact plan is not runtime readiness until one authority fetches, verifies, publishes, and reports the bytes without assuming a physical VFS layout
user_story: As an npm-client consumer, I want install success to mean every planned runtime asset is verified and ready through a storage-qualified receipt
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-asset-catalog-plan]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/npm-client/0201-bounded-fetch-chokepoint-no-progress-stall-bounds-on-all-npm-client-fetches.md, docs/adr/npm-client/0258-structured-install-acquisition-provenance.md]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/index.ts, packages/npm-client/src/fetch-and-unpack.ts, packages/npm-client/src/tarball-cache.ts, packages/npm-client/src/registry.ts]
---

## Context

This is the deep, realm-local module. Its storage interface uses semantic
entries rather than paths, so Memory VFS now and the future Workbench-private
adapter exercise the same manager without exposing `workspaceId`, project
roots, or owner protocols.

## Acceptance

- npm-client exports `createShadowAssetManager`, consumer/admin interfaces,
  descriptor/plan/receipt/progress/error types, and two real adapters: storage
  backed by `MemoryVfs` for tests/SDK use and the STD registry source using the
  injected `RegistryClient` plus existing tarball cache.
- Storage is path-neutral:
  `ShadowAssetStorageEntry` is exactly
  `temp(id)|object(sha256)|receipt(sha256)|ready(requiredSetDigest)`.
  `ShadowAssetStorage` exposes storage class, read/write/remove,
  acknowledgement, usage, clear, and close. The adapter owns path mapping and
  the durability acknowledgement; manager code never constructs a VFS path.
- `ShadowAssetManager` owns descriptor validation, per-hash single-flight,
  learned state needed by transports, hit re-verification, bounded fetch,
  exact-member extraction, publish/receipt ordering, recovery, and shutdown.
  `ShadowAssetInstaller` exposes `ensure(plan, options?)` and
  `inspectReceipt(setDigest)` to install/acquisition authority.
  `ShadowAssetRuntimeReader` exposes only
  `readVerified(asset, {signal?, deadlineMs?, onProgress?})` to runtime adapters;
  its default deadline is finite and callbacks/signals remain realm-local.
  `ShadowAssetAdmin` exposes `inspectUsage()` and `clearCache()`; manager
  lifecycle alone exposes `close()`. Children never receive installer, admin,
  or manager lifecycle authority.
- A hit re-hashes the object. A miss tries a valid SRI-keyed tarball-cache
  entry, otherwise resolves exact source name/version through the injected
  registry/auth configuration, requires manifest name/version and
  `dist.integrity` equality, then uses the bounded fetch chokepoint. No catalog
  stores a registry URL.
- Exact-member extraction accepts one matching regular file. It rejects
  missing/duplicate matches, links, absolute/traversal/non-normal paths,
  truncated archives, SRI/hash/declared-size mismatch, and either cap breach.
  It must not reuse the current last-member-wins whole-archive helper.
- Publish order is unique temp write → acknowledgement → final object →
  acknowledgement → read-back hash → immutable receipt →
  acknowledgement → `ready/<requiredSetDigest>` pointer last →
  acknowledgement. Lookup validates pointer, receipt digest/set, and every
  object. No correctness claim relies on OPFS rename atomicity.
- Receipt records catalog id/digest, public package/version, substitution and
  runtime-adapter ids, source package/version/tarball SRI, member path/hash/size,
  fill transport/cache result, storage class, and required-set digest. A hit
  does not rewrite immutable provenance.
- `ensure` emits `cache-check|fetch|verify|persist|ready`; observer failure
  does not affect acquisition. One waiter cancellation does not abort a shared
  flight needed by another.
- `install()` validates the plan and manager before link/shim/lockfile mutation,
  builds `InstallTreeResult`, then starts and awaits `ensure`. A non-empty plan
  without an injected manager loud-throws
  `NotImplementedError('npm.install.shadowAssets')`. Empty plans preserve
  existing behavior.
- Tree success is `InstallTreeResult`; final result adds
  `shadowAssets: not-required|ready(receipt)`. Post-tree asset failure throws
  typed `ShadowAssetInstallError {code:'ESHADOWASSET', treeResult,
  requiredSetDigest, asset, phase, transports, recovery, cause}`. Dependency
  provenance/source remains tree-only.
- Admin clear waits active flights, clears the whole adapter store, awaits its
  acknowledgement, and turns future reads into misses. Quota errors report
  used/required bytes and explicit clear recovery; no ensure/update path sweeps
  or auto-deletes.
- Close rejects new work, settles flights/waiters, closes the source/storage
  adapters, and is idempotent. Abrupt owner death is outside this realm-local
  interface and becomes a MessagePort deadline concern in the next item.

## Observable proof

1. A real pinned esbuild-wasm tarball fills `MemoryVfs`, publishes one verified
   receipt, and reads exactly 13,918,738 bytes; a second ensure is a verified hit
   with zero source requests.
2. Fresh install with a non-empty plan exits success only after `ready`;
   post-tree persistence failure returns the typed tree result and never claims
   asset readiness. Empty-plan install is unchanged.
3. Clearing only objects re-extracts from tarball cache offline; clearing both
   store and tarball cache fails within the bounded-fetch contract.
4. Concurrent ensures share one writer. Cancellation, close, corrupt/torn
   state, quota, and every extraction boundary settle all callers honestly.

## Parity cases

1. STD extracted bytes == pinned tarball member == descriptor sha256.
2. Tarball SRI mismatch preserves the existing typed `EINTEGRITY` cause inside
   `ESHADOWASSET`.
3. Install with no required assets preserves current lockfile/tree/result and
   performs zero manager/source calls.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `corrupt-input` | malformed/duplicate/link/unsafe/oversize member | no object/receipt/ready publication |
| `torn-state` | fail each publish acknowledgement/read-back | later lookup is a miss; never false ready |
| `poisoned-cache` | bytes change under object/receipt/pointer key | hash/digest validation rejects and recovers |
| `concurrent-same-key` | install/read/ensure same missing hash | one writer; every waiter settles |
| `false-fallback` | object absent/corrupt, valid tarball cached | offline re-extraction succeeds before network |
| `false-fallback` | object and tarball absent, network fails | bounded named failure; no retry loop or readiness |
| `quota-perm-fail` | persist/clear acknowledgement fails | typed visible failure; readable verified data retained where possible |
| `unbounded-read` | registry/tarball stall or cap breach | bounded abort; no readiness pointer |
| `provenance-lie` | source manifest/SRI or fallback fact drifts | reject or record actual source; never planned provenance |
| `observable-order` | pre-tree failure vs post-tree asset failure | rollback/no tree result vs typed partial tree outcome |

## Out of scope

- Worker spawn, kernel capability publication, or MessagePort framing.
- Physical Workbench store paths, owner lifetime, public UI, or install stamp v4.
- Eddy acceleration, automatic GC, and external runtime adapters.

## Decisions

- Manager owns correctness; storage/source adapters own only their external
  mechanics and expose acknowledgements.
- Semantic storage entries keep the module deep and future composition
  conflict-free.
- No partial install success: tree state may be independently proven, but the
  command fails until asset readiness exists.
