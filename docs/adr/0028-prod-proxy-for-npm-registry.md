# ADR 0028: Vercel Edge Function proxies npm registry in production

Status: Accepted (promoted from Q-2026-05-24-007)
Date: 2026-05

## Context

ADR 0005 (D-004) established that the npm registry is reached through a configurable proxy. Dev uses Vite's `/npm-registry` proxy (`apps/playground/vite.config.ts`). Production needs an equivalent: direct calls to `registry.npmjs.org` from a `crossOriginIsolated` page fail CORP/CORS. PROJECT_PLAN.md §977 (Q4') and REVIEW_ACTIONS A-032 left this open as the M9-closure decision.

Three deployable shapes were considered.

## Options considered

- **A — Vercel Edge Function (chosen).** Single source file in the playground deploy proxying `registry.npmjs.org`, sets `Access-Control-Allow-Origin` and `Cross-Origin-Resource-Policy: cross-origin`. Zero extra infra; co-located with the playground; this repo already adds `vercel.json` for prod headers.
- **B — Cloudflare Worker.** Same shape, hosted separately. Equivalent runtime semantics; would split deploy across two providers.
- **C — Self-hosted nginx + Verdaccio mirror.** Full mirror with caching; over-engineered for a pet-project deploy, on-call burden.

## Decision

Production proxy is a Vercel Edge Function in the playground deploy. The route exposed to the client follows the dev convention (`/npm-registry/...`) so the `@rifty/npm-client` `REGISTRY_BASE_URL` configuration switches between dev and prod by changing one value (relative path in dev, same relative path served by the Edge Function in prod).

Migration to Option B (Cloudflare Worker) remains a single config change if Vercel's free-tier limits or pricing change; the Edge Function source is < 50 lines and provider-agnostic in shape.

## Consequences

- Production deploy gains one Vercel Edge Function file (under ~50 lines) that proxies both metadata (`GET /npm-registry/:pkg`) and tarballs (`GET /npm-registry/:pkg/-/:file.tgz`). It must set `Access-Control-Allow-Origin` and `Cross-Origin-Resource-Policy: cross-origin` on every response — without those headers the `crossOriginIsolated` page rejects the response.
- `@rifty/npm-client` continues to read `REGISTRY_BASE_URL`; no code change. Tests keep hitting their local mock; nothing in the test path touches Vercel.
- Caching strategy for tarballs is deferred — the Edge Function is a plain pass-through at first. If registry latency or quotas bite, a follow-up ADR adds caching (KV / Edge Config / Cloudflare Cache).
- Switching to Cloudflare Workers later is a config-only change in `vercel.json`/deployment config plus moving the Edge Function source; no consumer-side change.
- Closes Q4' in PROJECT_PLAN.md §977 and REVIEW_ACTIONS A-032.

## Acceptance criteria

- [ ] Edge Function source lives in the playground deploy (e.g. `apps/playground/api/npm-registry/[...path].ts` or equivalent Vercel path).
- [ ] Function sets `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin` on every response.
- [ ] `@rifty/npm-client` resolves prod URLs through `/npm-registry/...` exactly as it does dev URLs.
- [ ] OPEN_QUESTIONS.md moves Q-2026-05-24-007 to the "Promoted" section with this ADR as the resolution.
- [ ] PROJECT_PLAN.md §9 entry "Q4'" is removed; D-004 footnote points to this ADR.
