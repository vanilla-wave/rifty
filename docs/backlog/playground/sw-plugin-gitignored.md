---
area: playground
status: active
title: apps/playground/build/sw-plugin.ts swallowed by .gitignore (build/) — fresh-checkout CI red
created: 2026-06-08
why: The sw-plugin source lives under build/, which .gitignore swallows; a fresh checkout has no file → playground typecheck/CI goes red
sources: [A4, EPIC A, ADR-0016]
---
## Context
`apps/playground/build/sw-plugin.ts` is not committed because `.gitignore` ignores `build/`. On a fresh checkout the file is absent, so playground typecheck / CI goes red. The plugin bundles `packages/service-worker/src/sw.ts` → `apps/playground/public/sw.js` at dev/build (ADR-0016 single-source-of-truth). Note: ADR-0016's intent was that `sw.js` is gitignored + regenerated, but codebase reality diverges — `sw.js` is git-tracked + biome-ignored, while the *plugin* source is the one being swallowed.
## Options / Next
Next: stop `.gitignore` from swallowing the plugin source — either move `sw-plugin.ts` out of `build/` (e.g. to a non-ignored path), add a `!build/sw-plugin.ts` negation, or relocate the generator. Verify a clean `git clone` → `pnpm install` → `pnpm typecheck`/`vite build` is green.
## Reversibility
Reversible — file relocation / .gitignore negation; no public-API change. Near-term: a fresh-checkout CI red is live breakage.
