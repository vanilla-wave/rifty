---
area: playground
status: draft
title: Full browser e2e — real-vite worker-realm + Vite 8 HMR + iframe-preview + SW preview-routing via default/CI verification
created: 2026-06-08
why: Vite 8 disables HMR (ADR-0161) until the Rolldown WASI worker path has browser SAB/kernel-worker coverage for native server.ws.
user_story: As a developer using the rifty web playground, I want Vite 8 worker-boot + iframe-preview + SW routing + native Vite HMR to stay green on every push, but today the Vite 8 template runs with HMR disabled and the old opt-in HMR e2e is not proof for Rolldown's WASI worker pool.
sources: [TASKS M10, ADR-0050, ADR-0043, ADR-0048, ADR-0316, ADR-0145, ADR-0161]
---
## Context
Real upstream `vite@5.4` had an in-process headless smoke (2026-05-30, ADR-0050): `npm install vite` → loader `import('vite')` → `createServer` → `server.listen()` → `transformRequest('/src/main.js')`.

`tests/e2e/m10-hmr.spec.ts` now drives the full browser flow when `RIFTY_E2E_HMR=1`: visible terminal `vite` command → worker boots Vite → iframe-preview renders via SW routing → Monaco edit writes into the worker VFS → module graph invalidation + HMR reload. This is real coverage, but it is still skip-by-default because install/runtime cost is high.

Vite 8 changes the forcing consumer: Rolldown's WASI binding needs SAB +
kernel-backed `worker_threads` children. The standalone live smoke can verify
install + shims in plain Node, but import/createServer/transform proof requires
a browser kernel-worker harness. Per ADR-0161, HMR is disabled in the Vite 8
template until that harness also re-proves native `server.ws`.

## Options / Next
DONE (2026-06-20): the browser SAB/kernel-worker lane that boots Vite 8, imports
the Rolldown WASI binding (its emnapi pthread pool runs over kernel-backed
`worker_threads`), and serves the iframe through SW routing is now **CI-active** —
`tests/e2e/m7-preview-sw.spec.ts` (un-gated) drives a real cold Vite 8 install →
Rolldown WASI bundle → `/preview/5174/` and asserts the worker-owned HTML; `m1`
covers the instant (baked-snapshot) boot.

REMAINING: re-enable native Vite-owned HMR (`server.ws`) over the Rolldown WASI
path with the existing sentinel/no-full-reload assertion (HMR is still disabled
by ADR-0161). Update `docs/ROADMAP.md` once HMR is no longer opt-in-only.

## Reversibility
Reversible — test/CI coverage and docs only, no production API.
