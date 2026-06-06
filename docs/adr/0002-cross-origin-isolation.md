# ADR 0002: Cross-origin isolation is mandatory (D-001)

Status: Accepted
Date: 2026-05

Decision D-001 (PROJECT_PLAN.md §8): the playground runs only in `crossOriginIsolated === true`, served with `COOP: same-origin` + `COEP: credentialless`.

## Rationale

- M6 sync IPC (`execSync`, sync file calls) requires `SharedArrayBuffer` + `Atomics.wait`, which needs isolation.
- Async-everything alternative (Asyncify transform): orders of magnitude more work, slower at runtime → rejected.
- `credentialless` over `require-corp`: third-party assets work without CORP headers (credentials stripped). Correct trade-off for a sandboxed runtime.

## Consequences

- Vite dev-server sets the headers (`apps/playground/vite.config.ts`).
- Production host must allow custom response headers → GitHub Pages excluded; Vercel / Netlify / Cloudflare Pages work.
- All assets same-origin (or proxied); no direct CDN imports.
- M0 adds a runtime capabilities check + e2e test asserting `crossOriginIsolated === true`.
