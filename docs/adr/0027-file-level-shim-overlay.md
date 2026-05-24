# ADR 0027: Per-file shim overlays live in the consuming adapter

Status: Accepted (promoted from Q-2026-05-23-004)
Date: 2026-05

## Context

ADR 0006 (D-005, "shadow registry") covers **full-package** substitutions via `BUILT_IN_OVERRIDES` (`bcrypt → bcryptjs`). The M10 Real-Vite boot needs a finer substitution: install the real package (`esbuild`, `rollup`), then overwrite specific files inside it (`esbuild/lib/main.js`, `rollup/dist/native.js`) with browser-safe replacements. The rest of the real package — its `package.json`, `exports` map, types, peer entries — stays intact.

The provisional implementation (`apps/playground/src/adapters/esbuild-shim.ts`, `realVite.ts` calling `overlayShims()`) writes the shim files into the VFS after the npm-client linker finishes. This ADR ratifies that approach and sets the threshold for promoting it into the shadow registry proper.

## Options considered

- **A — Per-file overlay after `install()` (chosen).** Adapter writes shim files into VFS after link, before the loader sees them. Surgical: the real package's metadata keeps working, no fork required. Cost: ordering-sensitive; shim sources sit outside the npm-client layer.
- **B — Extend `BUILT_IN_OVERRIDES` to support partial-package shadows.** One place for "what we substitute and why", integrated with the install pipeline. Cost: larger npm-client API surface; harder to keep shim sources tightly coupled to the consuming adapter.
- **C — Full-package shadows of `esbuild` and `rollup`.** Clean: install our package instead of the real one. Cost: re-implements two big surfaces; can't piggy-back on their `exports`/types; doesn't degrade gracefully when Vite imports `esbuild/lib/something-else.js`.

## Decision

Use Option A (per-file overlay in the consuming adapter) until at least three shim sites exist. Today the count is two (esbuild's binary launcher, Rollup's native parser). At three (likely candidates: terser, swc, sass, fsevents) we promote the pattern into `@rifty/npm-client/shims/` with a typed registry — Option B.

Code sites covered by this ADR:

- `apps/playground/src/adapters/esbuild-shim.ts`
- `apps/playground/src/adapters/realVite.ts` (`overlayShims()` call site)

## Consequences

- Shim files live next to the adapter that needs them. Vite's needs and the shim source are reviewed together, which is the right unit while the list is short.
- Ordering invariant: every consumer of overlay shims must call `overlayShims()` **after** `install()` and **before** the module loader resolves the patched paths. New adapters in this style inherit that requirement.
- When a third shim site lands, the next PR creates `packages/npm-client/src/shims/` (or equivalent) with a typed registry, supersedes this ADR, and migrates the existing two shims. Adapters then declare their needs by name rather than writing files.
- ADR 0006 remains authoritative for **full-package** swaps. This ADR is the partial-package counterpart and is explicitly compatible with it.

## Acceptance criteria

- [ ] No `TODO(ADR): Q-2026-05-23-004` markers remain in the repo.
- [ ] `apps/playground/src/adapters/realVite.ts` invokes `overlayShims()` after the linker finishes; the two existing shims remain installed.
- [ ] OPEN_QUESTIONS.md moves Q-2026-05-23-004 to the "Promoted" section with this ADR as the resolution.
- [ ] A successor ADR is opened when a third shim site is introduced (tracked as the trigger for Option B promotion).
