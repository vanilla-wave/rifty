# ADR 0027: Per-file shim overlays live in the consuming adapter

Status: Accepted (promoted from Q-2026-05-23-004; corrected by ADR-0156)
Date: 2026-05

> TL;DR: per-file shims are overlaid into the VFS by the consuming adapter post-`install()`, not the npm-client layer; promote to a typed `shims/` registry at 3 sites

> Correction 2026-06-20: ADR-0156 satisfies the three-site promotion trigger —
> LightningCSS (Vite 8) is the third per-file shim site after esbuild and Rollup,
> so Vite browser shims now declare through the typed `browserShimFileSets`
> registry in `@riftydev/shadow-registry`. The per-file-overlay-post-`install()`
> model stands; only the "ad-hoc overlay list until 3 sites" clause is superseded.

## Context

ADR 0006 (D-005, "shadow registry") covers **full-package** swaps via `BUILT_IN_OVERRIDES` (e.g. `bcrypt → bcryptjs`). M10 Real-Vite needs finer granularity: install the real package (`esbuild`, `rollup`), then overwrite specific files inside it (`esbuild/lib/main.js`, `rollup/dist/native.js`) with browser-safe replacements while keeping the package's `package.json`, `exports` map, types, and peers intact. The provisional implementation (`esbuild-shim.ts`, `realVite.ts` calling `overlayShims()`) writes shims into the VFS after the npm-client linker finishes; this ADR ratifies it and sets the promotion threshold.

## Options considered

- **A — Per-file overlay after `install()` (chosen).** Adapter writes shim files into VFS post-link, before the loader sees them. Surgical; real package metadata keeps working; no fork. Cost: ordering-sensitive; shim sources sit outside the npm-client layer.
- **B — Extend `BUILT_IN_OVERRIDES` for partial-package shadows.** Single place for "what we substitute and why", integrated with install. Cost: larger npm-client API surface; harder to couple shim sources to the consuming adapter.
- **C — Full-package shadows of `esbuild`/`rollup`.** Clean: install our package instead. Cost: re-implements two big surfaces; can't reuse their `exports`/types; degrades poorly when Vite imports other files (e.g. `esbuild/lib/something-else.js`).

## Decision

Use Option A until at least **three** shim sites exist. Today: two (esbuild's binary launcher, Rollup's native parser). At three (likely candidates: terser, swc, sass, fsevents) promote to `@riftydev/npm-client/shims/` with a typed registry — Option B.

Code sites covered:

- `apps/playground/src/adapters/esbuild-shim.ts`
- `apps/playground/src/adapters/realVite.ts` (`overlayShims()` call site)

## Consequences

- Shim files live next to the adapter that needs them; Vite's needs and shim source are reviewed together — the right unit while the list is short.
- Ordering invariant: consumers must call `overlayShims()` **after** `install()` and **before** the loader resolves the patched paths. New adapters inherit this.
- A third shim site triggers `packages/npm-client/src/shims/` (or equivalent) with a typed registry, supersedes this ADR, and migrates the two existing shims; adapters then declare needs by name instead of writing files.
- ADR 0006 stays authoritative for **full-package** swaps. This ADR is the partial-package counterpart, explicitly compatible with it.

## Acceptance criteria

- [ ] No `TODO(ADR): Q-2026-05-23-004` markers remain in the repo.
- [ ] `apps/playground/src/adapters/realVite.ts` invokes `overlayShims()` after the linker finishes; the two existing shims remain installed.
- [ ] OPEN_QUESTIONS.md moves Q-2026-05-23-004 to "Promoted" with this ADR as resolution.
- [ ] A successor ADR is opened when a third shim site is introduced (Option B promotion trigger).
