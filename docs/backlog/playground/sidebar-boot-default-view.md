---
area: playground
status: active
title: Playground sidebar boot default — Explorer vs Presets
created: 2026-06-08
why: VSCode shell puts Explorer + Presets behind an activity bar; one must be the boot default — choice carries a live TODO(ADR) marker
sources: [ADR-0075]
code: [apps/playground/src/glue/layout-store.ts:38]
---
## Context
ADR-0075 recomposed the left rail into activity-bar + sidebar. Old left rail was the preset gallery; both Explorer and Presets now sit behind the activity bar. Chosen boot default: **Explorer** (file manager is the headline new feature; VSCode opens to Explorer). Verified no e2e asserts `[data-testid="gallery"]`/`[data-preset]` at boot, so selector-safe. Live `// TODO(ADR)` at the `useLayout` default `view` initializer.
## Options / Next
Provisional: default to Explorer. Alternative: default to Presets if the welcoming "click a preset" first-touch is preferred — a one-line default flip. Next: confirm Explorer-vs-Presets first-touch with a human, then promote to ADR via `pnpm adr:new playground` (manual) (clears marker) or flip default.
## Reversibility
Reversible — flip one default; selector-safe (no e2e gates the boot view). Provisional marker in code.
