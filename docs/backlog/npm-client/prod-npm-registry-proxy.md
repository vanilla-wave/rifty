---
area: npm-client
status: active
title: Prod npm-registry proxy never deployed — blocks prod (UNMET M9 acceptance)
created: 2026-06-08
why: ADR-0028 ratified Vercel Edge Fn but source never landed; no live URL, playground never deployed to prod
sources: [M11, Q-2026-05-24-007, A-032, ADR-0028, PROJECT_PLAN Q4'/D-004, TASKS M9, follow-ups-architecture-review-2026-05-27 item#3]
---
## Context
COI playground (D-001) cannot fetch `registry.npmjs.org` directly (CORP/CORS forbid). Dev solved via Vite proxy (D-004). Prod needs equivalent so `@riftydev/npm-client.REGISTRY_BASE_URL='/npm-registry'` resolves metadata+tarballs through a deployed proxy emitting `ACAO:*` + `CORP:cross-origin` on every response. ADR-0028 ratified but acceptance#1 unmet — no Edge Fn file (`apps/playground/api/npm-registry/[...path].ts` or equiv), no live URL; ADR downgraded to Provisional 2026-05-27. Real unmet milestone acceptance + deployment gap, not a doc artifact.
## Options / Next
Provisional: Option A — Vercel Edge Fn (<50 lines, co-located w/ playground deploy, reuses vercel.json headers), candidate only until it exists+deploys+roundtrips a live install. Alts: B Cloudflare Worker (generous free tier, +1 deploy target), C self-hosted nginx+Verdaccio (over-engineered). Next: first prod-deploy PR writes the Fn and EITHER ratifies candidate w/ fresh ADR superseding ADR-0028 (concrete code refs) OR switches to B/C w/ fresh ADR.
## Reversibility
npm-client already reads REGISTRY_BASE_URL agnostic to target → revert cost ~0 today. Decision is candidate-only; ratification needs a superseding ADR (decision subagent reconsidering ADR-0028). Switching A→B later is config-only. Gate: first prod-deploy session (confirm-first — outward-facing deploy).
