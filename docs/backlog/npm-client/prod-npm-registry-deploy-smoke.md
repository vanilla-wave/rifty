---
area: npm-client
status: blocked
title: Production npm-registry proxy deploy smoke
created: 2026-06-12
why: proxy source now exists, but live deployment and registry round-trip verification are outward actions
sources: [ADR-0028, D-004, api/npm-registry/[...path].ts]
code: [api/npm-registry/[...path].ts, vercel.json]
---

## Context

The repo now contains the Vercel Edge-compatible `/npm-registry` proxy source
and rewrite. Local tests verify path forwarding and CORS/CORP headers, but a
real production URL has not been deployed or smoke-tested.

## Options or Next

- After explicit deploy approval, deploy the playground.
- Smoke `GET /npm-registry/<package>` and a tarball URL through the deployed
  origin.
- If the Vercel shape works, ratify ADR-0028 with a successor that cites the
  concrete source path and live evidence. If it fails, choose another proxy host
  with a successor ADR.

## Reversibility

BLOCKED on confirm-first outward deployment. Repo-local source changes are
reversible; ratifying the production proxy target needs a successor ADR.
