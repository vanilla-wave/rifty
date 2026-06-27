---
area: playground
status: draft
title: e2e runs the DEV build only — prod-build-only runtime bugs escape CI
created: 2026-06-21
why: the etag-over-express 500 (Buffer class duplicated across prod worker chunks) reproduced ONLY on the production bundle (`vite build`/Netlify deploy), never on the `pnpm dev` e2e — so a green CI shipped a broken deploy
user_story: As a dev trusting green CI before a deploy, I want the e2e to exercise the PRODUCTION bundle (the artifact users actually run), but today playwright's webServer is `pnpm dev`, so prod-only runtime divergences (module/Buffer identity across bundled worker chunks, CJS/ESM interop) sail through green.
sources: [playwright.config.ts, apps/playground/vite.config.ts (preview block), packages/io/src/buffer.ts]
code: [playwright.config.ts, tests/e2e/fullstack-demo.spec.ts]
---

## Context

`fullstack-demo.spec.ts` (express-sqlite) is CI-active and GREEN, yet the live PR
deploy 500s every `res.json` with `TypeError: argument entity must be string,
Buffer, or fs.Stats`. Root cause: the prod multi-worker bundle DUPLICATES
`@riftydev/io`'s `Buffer` class — `globalThis.Buffer !== require('buffer').Buffer`
in a prod worker (confirmed via a startup probe) — so express's `Buffer.from`
(one copy) was rejected by etag's identity-based `Buffer.isBuffer` (the other).
Fixed by a `Symbol.for` brand on `Buffer` (bundling-robust isBuffer/instanceof).

The DELIVERY gap that let it ship green: playwright's `webServer` runs `pnpm dev`
(unbundled — one module instance, so no duplication), never `vite build` +
`vite preview` (the deployed artifact). So any prod-only runtime divergence —
duplicated class identity across bundled worker chunks, minifier-driven CJS/ESM
interop (`import x from 'cjs-fn'` gave a non-function default in the same prod
worker), tree-shaking of a side-effecting registration — is invisible to CI.

Two distinct things worth follow-up:
1. **Prod-build e2e lane** — at least one smoke (the express-sqlite round-trip is a
   good candidate: it exercises real Buffer/etag/module-loader across worker chunks)
   run against `vite preview` of `dist/`, not `pnpm dev`. vite.config already serves
   COOP/COEP on the preview server, so COI holds.
2. **Why the prod bundle duplicates `@riftydev/io`'s `Buffer`** — the brand fix makes
   `isBuffer`/`instanceof` robust regardless, but a single Buffer instance per worker
   would be cleaner (a `manualChunks`/dedupe build-config question). Investigate
   whether the global-install import path and the `node:buffer` builtin registration
   land in different chunks.

## Options or Next

Add a `prod-smoke` playwright project (or a separate config) whose `webServer` is
`pnpm --filter @riftydev/playground build && vite preview --port <p>`, running the
express-sqlite render + API round-trip + ETag assertion. Gate cost: one build per
CI run. Failing-first proof exists (this very bug). Then optionally chase the
Buffer-duplication build cause for #2.

## Reversibility

Reversible — CI/test infra + an optional build-config dedupe. No production API change.
