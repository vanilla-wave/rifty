---
area: playground
status: active
title: vite8 — production build/preview (`vite build`/`vite preview`/`vite optimize`) over the Rolldown WASI path
created: 2026-06-21
why: The real-vite sandbox is dev-server-only. `vite build`/`preview`/`optimize` have no implementation; until this lands they LOUD-reject (real-vite-bootstrap.ts) instead of silently booting the dev server — honest stopgap, but a real Vite capability is missing.
user_story: As a dev in the playground, I want `vite build` to produce a `dist/` bundle and `vite preview` to serve it (like a fresh `npm create vite` project), but today the sandbox is dev-only and `vite build`/`preview`/`optimize` loud-reject.
sources: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/dev-server-boot.ts, docs/adr/runtime-js/0162-vite-8-rolldown-wasi-browser-boot-runtime-surface.md, docs/public/compat/incompatible-packages.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

`runDevServer` (Rolldown WASI over kernel-backed `worker_threads`) is the only
Vite path. No code calls `vite.build()`/`vite.preview()`; nothing writes a `dist/`.
The `vite` shell command now loud-rejects `build`/`preview`/`optimize`
(`TODO(backlog: playground/vite8-production-build-preview)` at the spawn site);
`npm run build` already loud-rejects (the template seeds no build script).

## Options or Next

Wire `vite.build()` (Rolldown WASI) → emit the bundle into the VFS `dist/`, then
`vite.preview()` (or a static serve of `dist/`) exposed through the SW preview
routing the dev server already uses. Acceptance: `vite build` writes a real
`dist/` and exits 0; `vite preview` serves it; a render-guard e2e (m7-style)
asserts the BUILT output renders. No fake/empty dist, no silent fall-through.

## Reversibility

REVERSIBLE — additive command path over the existing Rolldown WASI + SW-routing
infrastructure; no public-API/ADR contradiction. The interim loud-reject is the
honest gap until then.
