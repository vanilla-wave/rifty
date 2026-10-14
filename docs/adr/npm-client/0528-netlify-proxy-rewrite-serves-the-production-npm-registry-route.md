# ADR 0528: Netlify proxy rewrite serves the production npm-registry route

Status: Accepted
Date: 2026-10

> TL;DR: the Yandex Cloud VMs behind `registry.rifty.dev` and `eddy.rifty.dev`
> stopped answering (2026-10-13: origin TCP timeout, CDN edge 504/403). The
> production playground now installs through a same-origin `/npm-registry/*`
> Netlify proxy rewrite to `registry.npmjs.org`; eddy is OFF in the production
> build. Partially supersedes ADR-0163 (decisions 1 and 4 plus its "Netlify
> static only" TL;DR clause; decisions 2, 3, 5 stand as the dedicated-proxy
> runbook) and revisits the direct-Netlify-redirect option ADR-0133 rejected.
> Accepted degradation: no owned CDN tier, no fast-install path, 26 s Netlify
> proxy timeout per request, npm bytes metered as Netlify bandwidth.

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
- ADR-0133 (removed; its option-B rejection was never grafted into 0163, so
  no active rule is overturned here) rejected exactly this ("no tested handler
  seam for method policy, CORS/CORP headers, env-driven upstream"). Those
  reasons no longer bind:
  the route is same-origin, so the browser needs no CORS/CORP; method policy
  is moot (the client only GETs); the upstream is one static rule, which
  `tests/integration/prod-npm-registry-proxy.test.ts` pins.
- A dead resolver is worse than none: with `VITE_RIFTY_RESOLVER_URL` set,
  every from-scratch install waits the eddy header-stall bound (ADR-0201)
  before the standard path runs. ADR-0182 makes eddy opt-in and default OFF.

## Candidates

- **A — Netlify 200 rewrite, same-origin `/npm-registry` (chosen).** Keeps
  ADR-0005's dev/prod route shape and the operator-owned routing seam; live
  smoke + browser install proof below; Netlify Edge caches per upstream
  headers. Costs: 26 s cap, npm bytes ride Netlify bandwidth, shared egress IPs.
- **B — `VITE_RIFTY_REGISTRY_URL=https://registry.npmjs.org` (direct).** One
  env line; probe 2026-10-14: npmjs sends `access-control-allow-origin: *` on
  packument and tarball, COEP `credentialless` admits CORS-mode fetches, the
  client sends no preflight-triggering header. No 26 s cap, no Netlify
  bandwidth, per-user npm rate buckets. Killed for now: CORS policy outside
  operator control, ADR-0163 §Context still rejects direct browser calls, and
  the same-origin route shape is lost. Stays the documented one-line fallback
  if Netlify bandwidth metering becomes a cost (see Consequences).
- **C — Netlify Function proxy (ADR-0133 shape).** Killed: buffered bodies,
  function build state, runtime site env — machinery A delivers without.

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
- Slower: no owned CDN tier (ADR-0176) and no eddy fast path. Netlify Edge
  does store proxied responses per upstream `Cache-Control` (observed
  `cache-status: "Netlify Edge"; … stored`, `age` growing on repeat hits), so
  immutable tarballs and 300 s packuments still get an edge cache. A single
  response slower than 26 s fails on Netlify's proxy timeout — the client
  fetches FULL packuments (`docs/backlog/npm-client/abbreviated-packuments.md`),
  so the largest ones on a slow edge are the real risk; the retry ladder
  (ADR-0201 bounds) surfaces it loudly, never silently.
- Proxied npm bytes (a cold Vite install moves tens of MB of full packuments
  and tarballs) are served and, per Netlify's model, metered as site bandwidth.
  Plan limits/overage were NOT verified in this change; if they can bill, that
  is a DEC-3 spend decision for the operator and candidate B is the switch.
- All users egress to npm through shared Netlify IPs, so npm 429 pressure
  rises; the client already retries 429/5xx with backoff (`RegistryClient`
  `maxRetries`).
- `tools/perf/bench.mjs` install passes need an explicit
  `VITE_RIFTY_REGISTRY_URL`; there is no live default origin to point at.
- `docs/public/hosting-yandex.md` becomes a restore runbook, not a description
  of live service.

## Acceptance

- [x] `tests/integration/prod-npm-registry-proxy.test.ts` pins: proxy rules
  precede the SPA fallback in both files, no `VITE_RIFTY_REGISTRY_URL` /
  `VITE_RIFTY_RESOLVER_URL` in `netlify.toml`, smoke targets the deploy
  outputs, no eddy smoke step; the standing ADR-0163 §3 / ADR-0176 Caddy
  assertions stay.
- [x] Deploy workflow fails if the built `apps/playground/dist` references
  `registry.rifty.dev` or `eddy*.rifty.dev` (a Netlify site env var could
  otherwise re-point the app at a dead host while the route smoke stays green).
- [x] Smoke covers a scoped packument (`/npm-registry/@types%2Fnode`) — Netlify
  splat handling of the encoded scope separator is platform behavior.
- [x] Live 2026-10-14, PR #371 preview
  `https://pr-371--rifty-playground.netlify.app`: deploy smoke
  `npm registry proxy smoke ok: …/npm-registry/vite + vite-8.3.4.tgz`;
  `/npm-registry/left-pad` 200 `application/vnd.npm.install-v1+json` 0.5 s,
  upstream `access-control-allow-origin: *` passed through, no CORP (none
  needed same-origin); tarball 200 gzip 0.4 s; full `vite` packument 38.9 MB
  200 in 6.5 s; `/`, `/sw.js` still static; `/npm-registry` root → registry
  JSON, not the SPA shell; scoped `/npm-registry/@types%2Fnode` → 200 JSON.
- [x] Browser install through the route, same preview, headless Chromium
  (`crossOriginIsolated=true`), `/?preset=real-vite&autorun=1`:
  `npm: installed 71 package(s) in 11.5s`, 169 `/npm-registry/*` requests, 0
  failed responses, 0 requests to `registry.rifty.dev` / `eddy*.rifty.dev`.
  The following `npm run dev` stops on an unrelated upstream drift
  (`vite esbuild runtime supports exact Vite 7.3.6; executed 7.3.7`, vite
  7.3.7 published 2026-10-06; the starter requests `^7.0.0`) — already
  repaired on open PR #341 (starters pinned to the admitted 7.3.6; evidence
  file `pr-341-starter-version-repair.md` in that branch's
  `distribution/reference` folder), not a registry-route fault.

## Reversibility classification

**IRREVERSIBLE** — contradicts recorded ADR decisions (0163 §1, §4 and its
"Netlify static only" TL;DR clause) and changes the production routing
contract. Recorded per DEC-2 with a dated §Corrections note in ADR-0163.

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
