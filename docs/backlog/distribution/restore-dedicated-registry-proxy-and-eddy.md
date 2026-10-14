---
area: distribution
status: draft
title: Restore a dedicated streaming registry proxy / CDN tier and re-enable eddy after the Yandex Cloud outage
created: 2026-10-14
why: ADR-0528 moved production installs to a same-origin Netlify proxy rewrite (26 s per-request cap, no owned CDN tier) and switched eddy OFF because both Yandex Compute VMs stopped answering; the fast path and the CDN cache are gone until an operator decides where a dedicated proxy/resolver lives
user_story: As a developer on play.rifty.dev, I want cold installs to keep the CDN-cached tarball tier and the opt-in eddy fast path, but today every install streams through Netlify's proxy and eddy is disabled
epic: fast-install-resolver
blocked_by: []
sources: [docs/adr/npm-client/0528-netlify-proxy-rewrite-serves-the-production-npm-registry-route.md, docs/adr/npm-client/0163-yandex-cloud-streaming-npm-registry-proxy.md, docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/public/hosting-yandex.md]
code: [netlify.toml, apps/playground/public/_redirects, .github/workflows/netlify.yml, tools/registry/smoke-npm-registry.mjs, tools/eddy/smoke-eddy.mjs, deploy/yandex/npm-registry/docker-compose.yml, deploy/yandex/eddy/docker-compose.coi.yml]
---

## Context

2026-10-13: `registry-origin.rifty.dev` (93.77.177.79) and `eddy.rifty.dev`
(89.169.128.66) time out at TCP; the Yandex CDN edges answer 504 / 403; DNS
still resolves. ADR-0528 keeps production alive on Netlify alone:
`/npm-registry/*` is a 200 rewrite to `registry.npmjs.org`, `VITE_RIFTY_RESOLVER_URL`
is unset, the eddy smoke left the deploy workflow. Degradation accepted there:

- no owned CDN cache tier for packuments/tarballs (ADR-0176); Netlify Edge
  does store proxied responses per upstream `Cache-Control` (observed
  2026-10-14), but with no operator control over it;
- 26 s Netlify proxy timeout per request (full `vite` packument 38.9 MB
  measured 6.5 s via the preview; the largest packuments on a slow edge are
  the exposure);
- npm bytes count as Netlify bandwidth: 105.6 MB per cold React-starter
  install (measured 2026-10-14); Free plan = 300 credits/month at 20
  credits/GB, exhaustion pauses every project of the team (ADR-0528
  §Consequences);
- no eddy fast path (`perf/benchmarks.json` eddy pass stays `unmeasured`).

Open operator fork, not decidable in-repo: recreate the Yandex resources from
the runbook (`docs/public/hosting-yandex.md`), rehost the Caddy compose + eddy
image elsewhere, or declare the Netlify rewrite the permanent production
route and retire `deploy/yandex/*`, the `registry*.rifty.dev` / `eddy*.rifty.dev`
records and `tools/eddy/smoke-eddy.mjs`.

## Challenge

challenge: <pending>

## Acceptance

1. One recorded decision (ADR superseding or confirming ADR-0528 §5): dedicated
   proxy/resolver restored at named hosts with the live smokes back in
   `.github/workflows/netlify.yml`, OR the Netlify route declared permanent and
   the dead-host config, docs and DNS rows removed → ADR-0528
2. If restored: `netlify.toml` sets `VITE_RIFTY_REGISTRY_URL` /
   `VITE_RIFTY_RESOLVER_URL` again only after both live smokes pass against the
   new hosts in the same PR → ADR-0528

## Out of scope

- Any change to the install client; the fallback contract (ADR-0182) already
  covers resolver absence.

## Decisions

- 2026-10-14 — recorded as a draft from the outage fix; the host choice is the
  operator's.
