# ADR 0528: Netlify proxy rewrite serves the production npm-registry route

Status: Accepted
Date: 2026-10

> TL;DR: the Yandex Cloud VMs behind `registry.rifty.dev` and `eddy.rifty.dev`
> stopped answering (2026-10-13: origin TCP timeout, CDN edge 504/403). The
> production playground now installs through a same-origin `/npm-registry/*`
> Netlify proxy rewrite to `registry.npmjs.org`; eddy is OFF in the production
> build. Partially supersedes ADR-0163 (decisions 1, 2, 4) and ADR-0133's
> rejection of a direct Netlify redirect. Accepted degradation: no CDN tier, no
> fast-install path, 26 s Netlify proxy timeout per request.

## Context

- ADR-0163 moved the registry proxy to a Yandex Compute VM (Caddy) with a
  Yandex CDN in front; ADR-0182/0195 put eddy on a sibling VM. Both VMs are
  unreachable; DNS (Yandex Cloud DNS) still resolves. Live probe 2026-10-14:
  `registry.rifty.dev/npm-registry/left-pad` → 504 from the CDN edge,
  `registry-origin.rifty.dev` and `eddy.rifty.dev` → connection timeout,
  `eddy-cdn.rifty.dev` → 403.
- Effect: every `npm install` on `play.rifty.dev` fails; every Netlify deploy
  job fails at its live smoke (PR #341 `Deploy playground`), so PRs cannot get
  a green deploy check.
- The only live hosting surface left is Netlify (landing + playground). The
  smallest honest mechanism it offers is a 200 rewrite to an external URL: a
  streaming proxy on Netlify's CDN, documented 26 s per-request timeout, no
  custom response headers on proxied content, upstream cache headers honored.
- ADR-0133 rejected exactly this ("no tested handler seam for method policy,
  CORS/CORP headers, env-driven upstream"). Those reasons no longer bind:
  the route is same-origin, so the browser needs no CORS/CORP; method policy
  is moot (the client only GETs); the upstream is one static rule, which
  `tests/integration/prod-npm-registry-proxy.test.ts` pins.
- A dead resolver is worse than none: with `VITE_RIFTY_RESOLVER_URL` set,
  every from-scratch install waits the eddy header-stall bound (ADR-0201)
  before the standard path runs. ADR-0182 makes eddy opt-in and default OFF.

## Decision

1. Production registry base is the relative `/npm-registry` default
   (`getRegistryBaseUrl`, ADR-0005 shape). `netlify.toml` no longer sets
   `VITE_RIFTY_REGISTRY_URL`.
2. `apps/playground/public/_redirects` (processed first by Netlify) and
   `netlify.toml` (mirror) rewrite `/npm-registry/*` →
   `https://registry.npmjs.org/:splat` and `/npm-registry` →
   `https://registry.npmjs.org/`, both status 200, both BEFORE the SPA
   fallback. Playground production traffic to the registry is same-origin.
3. `VITE_RIFTY_RESOLVER_URL` is unset in the production build: eddy OFF. The
   eddy live smoke steps leave `.github/workflows/netlify.yml`.
4. Deploy smoke (`tools/registry/smoke-npm-registry.mjs`) targets the deployed
   playground origin itself (preview: the immutable deploy URL; production:
   `https://<site>.netlify.app`) and asserts registry JSON + gzip tarball, no
   CORS/CORP headers.
5. `registry.rifty.dev`, `registry-origin.rifty.dev`, `eddy*.rifty.dev` and the
   checked-in `deploy/yandex/*` configs stay as the recorded way to run a
   dedicated streaming proxy/resolver; nothing in the production path depends
   on them. Re-enabling a dedicated proxy or eddy is a new decision
   (`docs/backlog/distribution/restore-dedicated-registry-proxy-and-eddy.md`).

## Consequences

- Production installs work again with zero operator-owned infrastructure
  beyond Netlify; a PR's deploy check is green again.
- Slower: no Yandex CDN tarball/packument cache (Netlify CDN nodes may cache
  per upstream `Cache-Control`, unverified), no eddy fast path. A single
  response slower than 26 s fails on Netlify's proxy timeout — real risk only
  for the largest packuments on a slow edge; the client's retry ladder
  (ADR-0201 bounds) surfaces it loudly, never silently.
- `tools/perf/bench.mjs` install passes need an explicit
  `VITE_RIFTY_REGISTRY_URL`; there is no live default origin to point at.
- `docs/public/hosting-yandex.md` becomes a restore runbook, not a description
  of live service.

## Acceptance

- [x] `tests/integration/prod-npm-registry-proxy.test.ts` pins: proxy rules
  precede the SPA fallback in both files, no `VITE_RIFTY_REGISTRY_URL` /
  `VITE_RIFTY_RESOLVER_URL` in `netlify.toml`, smoke targets the deploy
  outputs, no eddy smoke step.
- [ ] Live: PR preview deploy smoke passes against the preview origin
  (`/npm-registry/vite` JSON + latest tarball through the Netlify rewrite).

## Reversibility classification

**IRREVERSIBLE** — contradicts recorded ADR decisions (0163 §1, §2, §4;
0133 option B rejection) and changes the production routing contract.
Recorded per DEC-2 with a dated §Corrections note in ADR-0163.

## Cited ADRs and docs

- ADR-0005 — same-origin `/npm-registry` route shape (dev proxy).
- ADR-0133 (removed, context in 0163) — rejected direct Netlify redirect;
  the SPA-shell-masks-proxy incident this ADR's rule order guards against.
- ADR-0163 — Yandex Cloud streaming proxy (partially superseded here).
- ADR-0176 — CDN cache headers (tier now absent in production).
- ADR-0182 / ADR-0195 — eddy opt-in resolver (OFF in production build).
- ADR-0201 — bounded fetch (why a dead resolver costs wall-clock).
- Netlify docs "Rewrites and proxies" (checked 2026-10-14): 26 s proxy
  timeout; custom headers are not applied to proxied content; cacheable
  upstream responses may be cached by CDN nodes.
