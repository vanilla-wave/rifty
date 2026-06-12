---
area: playground
status: active
title: Full browser e2e — real-vite worker-realm + HMR + iframe-preview + SW preview-routing via default/CI verification
created: 2026-06-08
why: M10 open acceptance — real upstream vite@5.4 runs headless and opt-in browser e2e exists, but the cross-origin-isolated browser wiring is not yet part of default/CI verification
sources: [TASKS M10, ADR-0050, ADR-0043, ADR-0048, ADR-0047]
---
## Context
Real upstream `vite@5.4` runs in-process headless (2026-05-30, ADR-0050): `npm install vite` → loader `import('vite')` → `createServer` → `server.listen()` → `transformRequest('/src/main.js')`, regression-covered by opt-in `tests/integration/vite-live-run.opt-in.test.ts`.

`tests/e2e/m10-hmr.spec.ts` now drives the full browser flow when `RIFTY_E2E_HMR=1`: visible terminal `vite` command → worker boots Vite → iframe-preview renders via SW routing → Monaco edit writes into the worker VFS → module graph invalidation + HMR reload. This is real coverage, but it is still skip-by-default because install/runtime cost is high.

## Options / Next
Add a default or CI lane for the flow once cost/flakiness is acceptable, or split a cheaper smoke that still proves worker+iframe+SW routing without a full cold Vite install. Update `docs/ROADMAP.md` once that verification is no longer opt-in-only.

## Reversibility
Reversible — test/CI coverage and docs only, no production API.
