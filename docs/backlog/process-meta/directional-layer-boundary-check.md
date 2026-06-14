---
area: process-meta
status: active
title: Enforce the no-reverse-imports layer rule in CI (madge catches cycles, not direction)
created: 2026-06-08
why: the "No reverse imports" hard rule is UNENFORCED — `check:deps` (madge --circular) only catches cycles; a one-way net→runtime-js edge slips past CI
user_story: As a maintainer relying on CI to guard layering, I want a one-way reverse edge like `net`→`runtime-js` to fail the build, but today `madge --circular` only flags cycles so an acyclic upward import lands green.
sources: [CLAUDE.md hard rules, ADR-0035, ADR-0012, A-013, A-014]
---
## Context
CLAUDE.md hard rule: layers go top-down vfs → kernel → runtime-* → net/shell → npm-client → playground, never reverse. CI enforces only `pnpm check:deps` = `madge --circular`. Madge catches **cycles**, not **direction**: a one-way reverse edge (e.g. net→runtime-js, like the A-014 inversion ADR-0035 fixed) is acyclic and passes CI silently. ADR-0035 removed that exact edge by hand; nothing prevents reintroduction. `check:isolation` only guards the solid-js D-002 rule, not layer direction.

## Options / Next
Add a directional layer-boundary check to CI alongside `check:deps`. Options:
- (A) `dependency-cruiser` with a layer-ranking ruleset (forbidden: import from a higher layer) — mature, declarative, but NEW dev dep (IRREVERSIBLE per checklist).
- (B) custom zero-dep `tools/checks/layer-boundaries.mjs` — assign each package a layer rank, scan `src/index.ts`-level imports, fail on any edge pointing up. No new dep, fits the zero-dep-helper bias.
Next: encode the canonical layer order once (single source), wire the chosen checker into the `lint-and-typecheck` CI job, add a fixture reverse-edge test that must fail loudly.

## Reversibility
Option A = new external dependency → IRREVERSIBLE, needs an ADR. Option B (custom script) = REVERSIBLE. Recommend B unless the ruleset grows past a trivial rank table.
