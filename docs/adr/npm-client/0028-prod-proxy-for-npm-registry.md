# ADR 0028: Vercel Edge Function proxies npm registry in production

Status: Provisional — implementation deferred to first deploy session (downgraded 2026-05-27; see "Status update" below)
Date: 2026-05

> TL;DR: prod npm proxy is a Vercel Edge Function serving the dev `/npm-registry/...` route with `CORP: cross-origin` headers; `REGISTRY_BASE_URL` flips dev↔prod

## Context

ADR 0005 (D-004) routes the npm registry through a configurable proxy. Dev uses Vite's `/npm-registry` proxy (`apps/playground/vite.config.ts`). Prod needs an equivalent: direct calls to `registry.npmjs.org` from a `crossOriginIsolated` page fail CORP/CORS. Left open as the M9-closure decision (PROJECT_PLAN.md §977 Q4', REVIEW_ACTIONS A-032).

## Options considered

- **A — Vercel Edge Function (chosen).** Single source file in the playground deploy, proxies `registry.npmjs.org`, sets the needed CORS/CORP headers. Zero extra infra; co-located with playground; repo already adds `vercel.json` for prod headers.
- **B — Cloudflare Worker.** Same shape, hosted separately. Equivalent runtime; splits deploy across two providers.
- **C — Self-hosted nginx + Verdaccio mirror.** Full caching mirror — over-engineered for a pet project, adds on-call burden.

## Decision

Prod proxy is a Vercel Edge Function in the playground deploy. It exposes the dev-convention route (`/npm-registry/...`), so `@riftydev/npm-client`'s `REGISTRY_BASE_URL` switches dev↔prod by changing one value (same relative path, served by the Edge Function in prod).

Migrating to Option B (Cloudflare Worker) stays a single config change if Vercel's free-tier/pricing shifts; the source is < 50 lines and provider-agnostic.

## Consequences

- Adds one Edge Function file (~50 lines) proxying metadata (`GET /npm-registry/:pkg`) and tarballs (`GET /npm-registry/:pkg/-/:file.tgz`). Must set `Access-Control-Allow-Origin` and `Cross-Origin-Resource-Policy: cross-origin` on every response, else the `crossOriginIsolated` page rejects it.
- `@riftydev/npm-client` unchanged — keeps reading `REGISTRY_BASE_URL`. Tests still hit their local mock; the test path never touches Vercel.
- Tarball caching deferred — plain pass-through first. If latency/quotas bite, a follow-up ADR adds caching (KV / Edge Config / Cloudflare Cache).
- Switching to Cloudflare Workers later: config-only change in `vercel.json`/deploy config plus moving the source; no consumer-side change.
- Closes Q4' (PROJECT_PLAN.md §977) and REVIEW_ACTIONS A-032.

## Acceptance criteria

- [ ] Edge Function source lives in the playground deploy (e.g. `apps/playground/api/npm-registry/[...path].ts` or equivalent Vercel path).
- [ ] Function sets `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin` on every response.
- [ ] `@riftydev/npm-client` resolves prod URLs through `/npm-registry/...` exactly as dev.
- [ ] OPEN_QUESTIONS.md moves Q-2026-05-24-007 to "Promoted" with this ADR as resolution.
- [ ] PROJECT_PLAN.md §9 "Q4'" entry removed; D-004 footnote points here.

## Status update — 2026-05-27

Originally marked **Accepted** when Q-2026-05-24-007 was promoted, but the 2026-05-27 architecture review (item #3 in `docs/follow-ups-architecture-review-2026-05-27.md`) flagged the status/reality gap: no Edge Function source in repo, no live URL, playground never deployed to prod. "Accepted" without code is *ADR-as-aspiration* — a dangerous failure mode that looks settled.

Downgraded to **Provisional**. The Edge Function stays the leading candidate (§Decision rationale stands) but is not ratified until: source exists, deploy succeeds with correct CORP/COEP headers, and the `npm-client` prod URL roundtrips through it. Once implemented, a new ADR (likely ADR-0046+) ratifies the chosen path with concrete code refs and supersedes this one.

Q-2026-05-24-007 is restored as Active in `OPEN_QUESTIONS.md`, scoped to the first prod-deploy session.
