# ADR 0002: Cross-origin isolation is mandatory (D-001)

Status: Accepted
Date: 2026-05

Summary of decision D-001 from PROJECT_PLAN.md §8. The playground only runs in `crossOriginIsolated === true` mode, served with `COOP: same-origin` + `COEP: credentialless`.

## Rationale

- M6 needs synchronous IPC (`execSync`, sync file calls). The only viable mechanism is `SharedArrayBuffer` + `Atomics.wait`, which requires isolation.
- The async-everything alternative (Asyncify-style transform) is multiple orders of magnitude more work and slower at runtime.
- `credentialless` significantly relaxes COEP versus `require-corp` — third-party assets work without CORP headers, at the cost of credentials being stripped. For a sandboxed runtime this trade-off is correct.

## Consequences

- Vite dev-server sets the headers (see `apps/playground/vite.config.ts`).
- Production hosting must allow setting custom response headers. GitHub Pages is therefore not an option; Vercel / Netlify / Cloudflare Pages all work.
- All assets must live on the same origin (or proxy through it). No direct CDN imports.
- M0 includes a runtime capabilities check and an e2e test that verifies `crossOriginIsolated` is `true`.
