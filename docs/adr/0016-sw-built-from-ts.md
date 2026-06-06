# ADR 0016: Service Worker source-of-truth lives in `@riftydev/service-worker`

Status: Implemented (2026-05-24) — plugin at `apps/playground/build/sw-plugin.ts`
Date: 2026-05

## Context

SW logic is duplicated: TS source `packages/service-worker/src/sw.ts` vs hand-edited JS copy `apps/playground/public/sw.js` (served verbatim by Vite). They drift — the JS lags the TS on every SW-protocol change, because the TS module has no pipeline emitting to `public/`. Flagged by REVIEW_ACTIONS A-017.

## Decision

TS module is the single source of truth; generate `sw.js` at build time.

- A Vite plugin (or small `pnpm` script in `vite.config.ts`) bundles `sw.ts` → `apps/playground/public/sw.js` on `vite dev` start and `vite build`. Output header: `// Generated from packages/service-worker/src/sw.ts — do not edit by hand`.
- Remove `apps/playground/public/sw.js` from VCS; add to `.gitignore`.
- SW protocol changes happen only in the TS source.

## Consequences

- SW protocol stops drifting between TS and JS.
- Negative: build-time coupling — `vite dev` must run the bundler before the page can register the SW (small cold-start cost: one esbuild pass on one file).
- Negative: bundled SW must stay a single self-contained file (no code-splitting), since SWs can't import modules at registration. Acceptable — SW logic is small.
- Follow-up: implementation lands in M11 unless the plugin is short enough to ship this session (orchestrator's call); the ADR stands either way as the design decision.

## Acceptance criteria for the deferred implementation

- [ ] `apps/playground/public/sw.js` is generated, not handwritten; first line is the generated-from header.
- [ ] Deleting it and re-running `pnpm dev` regenerates it.
- [ ] `apps/playground/public/sw.js` is in `.gitignore`.
- [ ] Changes to `sw.ts` propagate to the generated file on next dev-server start or build.
