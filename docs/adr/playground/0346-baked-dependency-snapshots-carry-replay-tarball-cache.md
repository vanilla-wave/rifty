# ADR 0346: Baked dependency snapshots carry replay tarball cache

Status: Accepted
Date: 2026-08

> TL;DR: dependency snapshot v3 carries only the integrity-pinned tarballs
> required by registry-backed shadow replay, verifies them before mutation, and
> merges them into the shared cache before publishing the restored lockfile.

## Context

Snapshot v2 restored `node_modules` plus `package-lock.json`, but not
`/.rifty/tarball-cache`. Ordinary lockfile replay may fetch a missing pinned
tarball. Registry-backed shadow replay deliberately may not: ADR-0335 requires
matching replay to regenerate exact files with zero registry reads. Therefore
the first explicit `npm install` after the Vite 8 baked restore failed
`EBROKENLOCK` on LightningCSS's absent pinned source bytes.

Deleting the lockfile loses installed-state fidelity. A registry fallback
overturns ADR-0335's provenance boundary. Carrying every ordinary tarball adds
bytes that the installer does not require for correctness.

## Decision

1. Snapshot v3 adds a tarball-cache archive. Its exact closure is the distinct
   `kind: 'registry'` acquisitions in the lockfile shadow trace. Synthetic
   acquisitions and ordinary lockfile packages contribute no bytes.
2. `@riftydev/npm-client` exports the pure `tarballCachePath` key function;
   snapshot bake and `VfsTarballCache` cannot drift on scoped-name or integrity
   prefix mapping.
3. Bake fails when a required entry is absent. The artifact gate and restore
   require an exact archive set and verify every entry against its traced SRI
   before any destination mutation. V2 is rejected and all committed assets
   are rebaked.
4. Restore replaces only project `node_modules`, merges the verified closure
   into the global cache, preserves unrelated cache entries, then writes the
   lockfile. The verified runtime-asset CAS from ADR-0320 remains separate.
5. Sibling sweep: templates without registry-backed shadow acquisitions carry
   an empty cache archive; Vite 8 carries the LightningCSS source acquisition.

## Fault matrix

| fault × operation | exact outcome / proof |
|---|---|
| `lossy-aggregate` / `torn-state` × bake/restore lockfile | required shadow acquisition bytes are part of v3; restore merges them before lockfile publication |
| `poisoned-cache` × snapshot ingress | SRI mismatch rejects before tree, cache, or lockfile mutation |
| `quota-perm-fail` × cache merge | restore throws; prior lockfile and sibling cache entries remain, new lockfile is not published |
| `sibling-drift` × cache key construction | one exported `tarballCachePath` shapes cache and snapshot paths |

## Consequences

- First explicit install after instant Vite 8 restore can replay its shadow
  substitution offline without weakening provenance.
- Only templates with registry shadow acquisitions grow, by those compressed
  source tarballs; ordinary cache misses retain their existing network path.
- The v3 format and cache-key export are public compatibility commitments.

## Correction 2026-08-31 (ADR-0371)

Decision 4's separate runtime-asset CAS clause is withdrawn. Snapshot v3 now
carries the exact esbuild-wasm member in ordinary `node_modules`; its existing
verified replay tarball cache remains the network-byte authority.
