# ADR 0015: Shadow-registry consolidation under `tools/shadow-registry/`

Status: Accepted
Date: 2026-05

## Context

ADR 0006 (D-005) committed to a layered shadow-registry strategy with substitution sources rooted under `tools/shadow-registry/packages/*`. The current implementation is partial: `BUILT_IN_OVERRIDES` lives inside `packages/npm-client/src/overrides.ts`, adapter-side shims for `esbuild` and `rollup-native` live under `apps/playground/src/adapters/`, and the `tools/shadow-registry/` directory does not exist. The M9 milestone marks the registry as DONE, but in practice it is symbolic — the registry surface ADR 0006 describes has no central home.

REVIEW_ACTIONS entry A-007 flags the gap.

## Decision

Consolidate all shim/override sources under `tools/shadow-registry/`.

- New directory layout:
  - `tools/shadow-registry/overrides/` — full-package substitutions (moved from `packages/npm-client/src/overrides.ts`).
  - `tools/shadow-registry/shims/esbuild/` — moved from `apps/playground/src/adapters/esbuild-shim.ts`.
  - `tools/shadow-registry/shims/rollup-native/` — moved from `apps/playground/src/adapters/rollup-native-shim.ts`.
- `npm-client` reads the consolidated registry. `packages/npm-client/src/overrides.ts` becomes a ~5-line adapter that imports and re-exports the registry's override table.
- Adapter-side shim files under `apps/playground/src/adapters/` collapse to one-line re-exports.
- `unenv` integration is explicitly deferred. It pulls 200+ files and the M10 demo does not need it. The concrete trigger to add it: when three or more of `crypto` / `tty` / `perf_hooks` need a non-trivial implementation, `unenv` is preferred over hand-writing them. Captured here as a deferred-on-trigger decision, not on a milestone.

## Consequences

- ADR 0006's structural claim becomes operational rather than symbolic.
- Adding a new shim is a single-file change under `tools/shadow-registry/`; consumers do not need updating.
- Negative: the `tools/` directory gains build/test coverage requirements; `tools/shadow-registry/` modules must ship with their own type definitions and a small registry-discovery test.
- Negative: existing adapter imports in the playground move once; downstream code outside the repo (none today) would need a path update.
- Follow-up: implementation lands in M11.

## Acceptance criteria for the deferred implementation

- [ ] All shims live under `tools/shadow-registry/`; `rg "esbuild-shim|rollup-native-shim" apps/playground/src/adapters/` returns at most one-line re-exports.
- [ ] `BUILT_IN_OVERRIDES` no longer defined in `packages/npm-client/src/overrides.ts`; that file is a thin adapter reading from `tools/shadow-registry/overrides/`.
- [ ] A `tools/shadow-registry/index.ts` (or equivalent) enumerates registered substitutions; `npm-client` imports from it.
- [ ] Documentation in `docs/compat/` references the registry's location for new contributors.
