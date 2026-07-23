# ADR 0308: Package-generic builtin shadow-substitution registry with optional runtime binding

Status: Accepted
Date: 2026-07

> TL;DR: rifty ships one builtin package-generic shadow-substitution registry —
> a clone-safe recipe owns trigger/version, exact materialization/provenance,
> and an OPTIONAL runtime binding `{adapterId, assets}` dispatched through one
> owner-bundled executable-adapter registry; Vite is an acceptance consumer,
> never an activation condition, and Sass ships as the second substitution in
> the same series.

## Context

The #160 quarry proved the substitution mechanics (esbuild delegate synthesis,
lockfile provenance, runtime-asset store) but shaped them esbuild/Vite-first:
mandatory `runtimeAdapterId` + non-empty asset list in the recipe (quarry
ADR-0295/0298), child asset clients bound to Vite recognition (quarry
ADR-0296), and activation reachable only through the Vite integration. Direct
guest `require('esbuild')` / `import('esbuild')` — the plain-Node scenario —
could not activate the proven surface without Vite installed. Review recorded
this as goal drift from the epic's at-scale registry promise.

Quarry ADRs never merged to main; this ADR records the successor direction on
fresh `main` and the disposition of each quarry decision.

## Decision

- **One recipe data model.** A clone-safe substitution recipe owns
  trigger/version, exact materialization + acquisition provenance, and an
  optional runtime binding `{adapterId, assets}`. Runtime-asset planning
  filters to recipes WITH a binding; a valid install-only substitution (Sass
  Pattern 1) yields applied/materialization facts and an empty asset plan.
  Catalog data never carries functions.
- **Real adapter dispatch.** One owner-bundled executable-adapter registry
  resolves an admitted binding before guest entry. Generic
  owner/admission/bootstrap sees only attested substitution facts, adapter ids,
  and opaque adapter results/capabilities; it never tests package name, import
  target, Vite version, or Vite entry kind. The esbuild adapter activates from
  the installed/admitted substitution, so direct esbuild and Vite share one
  path. No public callback/plugin SPI: arbitrary third-party executable
  callbacks remain a separate construction-time trust decision; remote data
  never activates host code.
- **Lockfile provenance carries forward** (quarry ADR-0295/0298 mechanics under
  the generic model): applied-substitution trace + explicit materialization
  provenance in the lockfile; matching replay regenerates identical files
  without registry reads; unsupported versions/surfaces stay named
  `NotImplementedError` + compat ❌ — no fallback to host bytes, native
  binaries, or approximate output.
- **One strict ingress codec.** Every published or clone boundary strictly
  decodes a substitution plan exactly once; frozen owner-internal values use
  invariants. Root exports resolve per symbol: zero production consumers →
  delete; repo-shared primitive → declared `/internal` subpath + shared
  consumer contract suite; already-published behavior change → successor ADR.
- **Kernel unchanged** (quarry ADR-0300 confirmed): the adapter registry
  consumes capabilities through the same one-shot kernel entry-port mechanism;
  no new kernel concept.
- **Not adopted from the quarry:**
  - Vite-only immutable child binding (quarry ADR-0296) and Vite-gated
    activation (quarry ADR-0298's integration edge) — replaced by generic
    dispatch above; any surviving Vite-specific recognition lives only inside
    the concrete Vite/esbuild integration edge.
  - Vite temp-cache cluster (quarry ADR-0301/0302) — dead per ADR-0307 probe.
  - Shadow-specific Eddy asset source (quarry ADR-0299) — measured slower than
    the standard registry path on the same required set (median 1517 ms vs
    1358 ms, quarry `perf/benchmarks.json` `shadowAssetColdFillMs`, speedup
    0.89×); not ported. General npm Eddy is untouched.

## Consequences

- (+) A normal project installs exact `esbuild` and runs the proven
  `transform()` surface via direct `require`/`import` without Vite.
- (+) Adding Sass after the registry core changes only Sass
  policy/capsule/oracle/fixtures + generated data + docs + acceptance — the
  seam proof; a Sass change forcing edits to generic planner/manager/store/
  authority/bootstrap means the seam failed and returns to decision review.
- (−) The runtime-asset seam stays N=1 (esbuild) after this series; its
  generalization claim stays withdrawn until a second Pattern-2 package (e.g.
  sharp/libvips-wasm) lands — recorded as a hook, not a promise.
- Follow-ups: delivery slices registry-core → package-tree authority
  (ADR-0309) → esbuild/Vite cutover → Sass scale proof, each with
  Contract+RED / Final+GREEN.
