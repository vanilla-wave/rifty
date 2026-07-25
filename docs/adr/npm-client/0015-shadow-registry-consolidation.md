# ADR 0015: Shadow-registry consolidation under `tools/shadow-registry/`

Status: Implemented (2026-05-24)
Date: 2026-05

> TL;DR: All shim/override sources consolidate under `tools/shadow-registry/` (`bakedOverrides`/`esbuildShimFiles`/`rollupShimFiles`); `overrides.ts` + adapters become one-line re-exports

> Correction 2026-07-24 (ADR-0316): the shadow registry remains the central
> substitution owner, but the preview1 redirect and `esbuildShimFiles` carrier
> are removed. A catalog-owned synthetic `esbuild` recipe backed by admitted
> registry `esbuild-wasm` bytes replaces those esbuild-specific clauses;
> remaining substitution sources still follow this ADR.

## Context

ADR 0006 (D-005) committed to a layered shadow-registry rooted under `tools/shadow-registry/packages/*`, but that directory never existed. Sources were scattered: `BUILT_IN_OVERRIDES` in `packages/npm-client/src/overrides.ts`; `esbuild`/`rollup-native` shims in `apps/playground/src/adapters/`. M9 marks the registry DONE, but only symbolically — it has no central home. REVIEW_ACTIONS A-007 flags the gap.

## Decision

Consolidate all shim/override sources under `tools/shadow-registry/`.

- Layout:
  - `tools/shadow-registry/overrides/` — full-package substitutions (from `packages/npm-client/src/overrides.ts`).
  - `tools/shadow-registry/shims/esbuild/` — from `apps/playground/src/adapters/esbuild-shim.ts`.
  - `tools/shadow-registry/shims/rollup-native/` — from `apps/playground/src/adapters/rollup-native-shim.ts`.
- `npm-client` reads the consolidated registry; `overrides.ts` shrinks to a ~5-line re-export of the registry's override table.
- Playground adapter shim files collapse to one-line re-exports.
- `unenv` integration deferred (pulls 200+ files; M10 demo doesn't need it). Deferred-on-trigger, not on a milestone: add it when 3+ of `crypto`/`tty`/`perf_hooks` need non-trivial implementations (then `unenv` beats hand-writing).

## Consequences

- ADR 0006's structural claim becomes operational, not symbolic.
- Adding a shim is a single-file change under `tools/shadow-registry/`; consumers unchanged.
- Negative: `tools/` gains build/test coverage requirements; registry modules ship their own type defs + a registry-discovery test.
- Negative: playground adapter imports move once; out-of-repo downstreams (none today) would need a path update.
- Follow-up: implementation lands in M11.

## Acceptance criteria for the deferred implementation

- [x] All shims under `tools/shadow-registry/`; `apps/playground/src/adapters/esbuild-shim.ts` is a one-line re-export from `@riftydev/shadow-registry`.
- [x] `BUILT_IN_OVERRIDES` removed from `packages/npm-client/src/overrides.ts`; that file is a thin adapter reading `bakedOverrides` from `@riftydev/shadow-registry`.
- [x] `tools/shadow-registry/src/index.ts` enumerates substitutions (`bakedOverrides`, `esbuildShimFiles`, `rollupShimFiles`); `npm-client` and the playground adapter import from it.
- [ ] `docs/compat/` references the registry location for contributors. *(Deferred — `docs/compat/` is auto-generated; `tools/shadow-registry/README.md` + this ADR fill the gap. Revisit at M11 DoD compat-matrix regen.)*

## Implementation notes (2026-05-24)

- The sketched nested layout collapsed to a single `src/index.ts` with three named exports — the brief (≈190 lines incl. template strings) didn't justify the directory tax. Revisit if a third shim site appears (see ADR 0027 for the consumer-side cousin).
- `OverrideMap` is declared locally in shadow-registry, structurally identical to the type re-exported from `@riftydev/npm-client`. A type-only import would create a madge-visible cycle (npm-client depends on shadow-registry for the data table); structural typing keeps them compatible, asserted indirectly via `installer.ts` consuming both shapes through `resolveOverride`.
- `unenv` remains deferred; the trigger (3+ of `crypto`/`tty`/`perf_hooks` needing non-trivial implementations) has not been hit.
