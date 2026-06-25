---
area: playground
status: active
title: vite8 — production build/preview over the Rolldown WASI path
created: 2026-06-21
why: Vite 7 production build/preview is delivered by ADR-0173. The opt-in Vite 8 template still loud-rejects `vite build`/`vite preview` because its Rolldown WASI path is upstream-blocked; enabling it before that is fixed risks silent/corrupt output.
user_story: As a dev using the opt-in Vite 8 preset, I eventually want `vite build` to produce a real Rolldown `dist/` bundle and `vite preview` to serve it. Until Rolldown WASI is proven, those commands must loud-reject and the default Vite 7 preset is the production build/preview path.
sources: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/dev-server-boot.ts, docs/adr/runtime-js/0162-vite-8-rolldown-wasi-browser-boot-runtime-surface.md, docs/public/compat/incompatible-packages.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

The default Vite 7 template now supports production build/preview with real
Rollup WASM + esbuild-WASI (ADR-0173). Vite 8 is separate: its dev boot uses
Rolldown WASI, but build/preview stay rejected until that path has a verified
browser-safe production pipeline. `vite optimize` remains out of scope.

## Options or Next

Next: once Rolldown WASI build is proven upstream, wire Vite 8 `build()` to emit
a real `dist/`, then `preview()` through the existing production preview source.
Acceptance: real hashed dist, built iframe render, and a Vite 8 regression guard.
No fake/empty dist, no silent fall-through.

## Reversibility

REVERSIBLE — additive command path over the existing Rolldown WASI + SW-routing
infrastructure. The interim loud-reject is the honest gap until then.
