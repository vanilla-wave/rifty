# ADR 0016: Service Worker source-of-truth lives in `@riftydev/service-worker`

Status: Implemented (2026-05-24) — plugin at `apps/playground/build/sw-plugin.ts`
Date: 2026-05

## Context

The service worker logic is duplicated: `packages/service-worker/src/sw.ts` (the TypeScript source) and `apps/playground/public/sw.js` (a hand-edited JavaScript copy served by Vite). The two have drifted — the JS copy lags behind the TS source on every change to the SW protocol. The playground's bootstrap registers the `.js` file because Vite serves `public/` verbatim and the TS module has no build pipeline that emits to `public/`.

REVIEW_ACTIONS entry A-017 flags the divergence.

## Decision

Treat the TS module as the single source of truth and generate `sw.js` at build time.

- A Vite plugin (or a small `pnpm` script invoked from `vite.config.ts`) bundles `packages/service-worker/src/sw.ts` to `apps/playground/public/sw.js` on `vite dev` start and on `vite build`. Output starts with a header comment: `// Generated from packages/service-worker/src/sw.ts — do not edit by hand`.
- `apps/playground/public/sw.js` is removed from version control. `.gitignore` excludes the generated file.
- The TS source stays the only place where SW protocol changes happen.

## Consequences

- The SW protocol stops drifting between TS and JS copies.
- Negative: build-time coupling — `vite dev` must run the bundler step before the page can register the SW. Cold-start cost is small (a single esbuild pass on one file).
- Negative: the SW's bundled form must remain a single self-contained file (no code-splitting), since service workers cannot import modules at registration time in the way regular scripts can. Acceptable because the SW logic is small.
- Follow-up: implementation lands in M11 unless the plugin is short enough to ship in the current session (orchestrator's call); the ADR stands either way as the design decision.

## Acceptance criteria for the deferred implementation

- [ ] `apps/playground/public/sw.js` is generated, not handwritten; the file's first line is the generated-from header.
- [ ] Deleting the generated file and re-running `pnpm dev` regenerates it.
- [ ] `apps/playground/public/sw.js` is listed in `.gitignore`.
- [ ] Changes to `packages/service-worker/src/sw.ts` propagate to the generated file on the next dev-server start or build.
