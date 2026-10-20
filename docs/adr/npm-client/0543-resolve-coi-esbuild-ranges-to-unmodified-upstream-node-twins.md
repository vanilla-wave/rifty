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

In COI, no version allowlist, per-version facade patches, copied declarations or
native esbuild oracle. Verified versions remain a finite evidence set, not admission.
Existing no-COI generated-client patches remain a declared platform gap with
no-coi-child-processes as the kill condition. Fixture pins preserving the
existing no-COI byte oracle and the Vite starter pin remain independent.

## Corrections

- 2026-10-20 — current-catalog tier changes may retain the exact attested
  acquisition/version/bin placement. The selected recipe validates retained
  metadata before publication; cache SRI and the strict trace reader remain
  authoritative. No obsolete catalog trace is upgraded.
- 2026-10-20 — snapshot preflight verifies cache, then uses the same recipe
  selection and receipt writer to replace only generated facade files. All
  ordinary/upstream bytes and pins stay fixed: those ordinary tarballs are not
  in snapshot replay cache. Restore/application share this preflight. Omitted
  tier preserves the existing low-level helper behavior.
- 2026-10-20 — no-COI keeps the build-generated install identity; COI uses
  SHA-256 of that identity + NUL + `coi`. Snapshot source identities must be
  current before target-policy preparation; the existing stamp authority mints
  and checks the selected identity, retaining epochs/lock hashes/rollback.
- 2026-10-20 — PR-4: the new snapshot refusal assertion incorrectly required
  lowercase `no-coi`; existing admission says `no-COI`. Independent Contract
  reviewer accepted name/feature + case-insensitive tier instead; target
  preservation unchanged.
- 2026-10-20 — both policy identities are generated at build time. A runtime
  SHA import from the registry package violated the existing no-COI lazy-install
  graph proof; reading generated strings preserves that boundary. No extra
  lazy projection wrapper or relaxed loading criterion is needed.

- 2026-10-20 — fresh DEC-2/DEC-5 critic accepted COI-only partial supersession
  of ADR-0226 D1–D5 generated-runtime/oracle clauses (including D4 Sync
  validation-before-gap), ADR-0316 exact-runtime/CLI-gap clauses, ADR-0361
  fixed acquisition/replay, ADR-0371 generated binding/startup and ADR-0384
  D2/Alternatives. Stock Node differentials: 0.21.5/0.25.12/0.28.2. No-COI
  generated semantics/native oracle, common CJS interop, integrity/replay/bin
  authorities, ADR-0375 D6 pinned byte proof and starter pins remain.
