# ADR 0543: Resolve COI esbuild ranges to unmodified upstream Node twins

Status: Accepted
Date: 2026-10-20

## Context

esbuild-upstream-twin I1/I4/I5 replaces COI's exact generated client while
preserving no-COI's 0.28.0 client. Upstream 0.21.5/0.25.12/0.28.2 build and
async lifecycle run through their stock Node entry after generic Node fixes.
The installer still rejects older ranges and binds the generated client.

## Decision

- `InstallOptions.runtimeTier: 'coi' | 'no-coi'` is explicit host policy;
  omission retains the existing no-COI policy. Workbench's physical Worker
  owner selects COI; its no-COI installer selects no-COI. No ambient capability
  test or mutation of user overrides chooses acquisition.
- Keep the legacy exact recipe for no-COI. COI selects a distinct requested-
  range recipe: resolve esbuild-wasm with the requested esbuild range, retain
  every upstream file under esbuild-wasm, materialize a thin esbuild facade.
  Its main requires esbuild-wasm; bin requires its stock bin; version follows
  the resolution; types points to the twin's lib/main.d.ts. No runtime binding.
- Recipe templates use an explicit version placeholder, specialized after
  normal registry resolution. Compute file identities and recipe digest from
  that specialization. Replay selects recipe id + resolved version, without
  registry access. Fixed recipes keep their strict projection rules; the
  requested-range recipe uses ordinary registry dependency metadata, not an
  empty-dependencies admission ceiling. Lock entries retain those facts.
- Tier selection disambiguates equal trigger names. Existing user override
  precedence remains. A no-COI-incompatible request or COI lock pin fails by
  name with the no-COI tier; never silently replace the pin with 0.28.0.
- Catalog identity changes deliberately invalidate old traced locks, including
  other recipes. No migration (goal decision). Existing integrity, replay,
  rollback and publication checks stay authoritative.
- Generated esbuild runtime loads only for an active no-COI binding. COI never
  imports it. Remove the COI Vite version gate; preserve no-COI preparation.
- COI oracle is unmodified esbuild-wasm on Node 24, captured per version/run.
  Stock Sync calls remain named loud gaps on Worker and execFileSync routes;
  COI does not retain generated-client validation-before-gap ordering.

## Consequences

No version allowlist, per-version facade patches, copied declarations or native
esbuild oracle. Verified versions remain a finite evidence set, not admission.
Existing no-COI generated-client patches remain a declared platform gap with
no-coi-child-processes as the kill condition. Fixture pins preserving the
existing no-COI byte oracle and the Vite starter pin remain independent.
