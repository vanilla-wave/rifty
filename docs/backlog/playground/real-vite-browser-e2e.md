---
area: playground
status: active
title: Full browser e2e — real-vite worker-realm + HMR + iframe-preview + SW preview-routing via Playwright
created: 2026-06-08
why: M10 open acceptance — real upstream vite@5.4 runs headless in-process, but the cross-origin-isolated browser wiring is not yet Playwright-covered
sources: [TASKS M10, ADR-0050, ADR-0043, ADR-0048, ADR-0047]
---
## Context
Real upstream `vite@5.4` runs in-process headless (2026-05-30, ADR-0050): `npm install vite` → loader `import('vite')` → `createServer` → `server.listen()` → `transformRequest('/src/main.js')`, regression-covered by opt-in `tests/integration/vite-live-run.opt-in.test.ts`. The **`Real upstream Vite (npm install vite && npm run dev)`** status (❌, "many transitive deps + esbuild.wasm dependency"; tracked in `docs/backlog/playground/`) is now headless-proven; the remaining gap is the browser end-to-end. The worker-realm + HMR + iframe-preview + SW preview-routing flow (`realVite.ts` → `real-vite-bootstrap.ts`) is not yet driven end-to-end in a cross-origin-isolated browser.
## Options / Next
Next: a Playwright spec driving the full path in a COI browser — load → toggle Real Vite → worker boots Vite → iframe-preview renders via SW `/preview/<port>/` routing → HMR update on edit, incl. ADR-0048 streaming preview for large bodies (vendor-prebundle, source maps). `m10-hmr.spec.ts` exists but is gated behind `RIFTY_E2E_HMR=1` (skipped by default, ~20 s Vite install per run); ADR-0123 covers the SW owner-routing prerequisites, so the remaining gap is browser e2e stability and CI cost. Update the `docs/backlog/playground/` status once green.
## Reversibility
Reversible — adds a test + CI gate, no production-API change. Blocked-ish on install/runtime cost and browser flake risk; otherwise stays opt-in.
