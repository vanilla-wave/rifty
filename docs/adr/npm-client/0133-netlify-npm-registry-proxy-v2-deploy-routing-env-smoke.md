# ADR 0133: Netlify npm-registry proxy v2 — netlify-build deploys, pre-SPA function redirects, runtime site env, buffered bodies, CI deploy smoke

Status: Accepted
Date: 2026-06-13

> TL;DR: supersedes ADR-0028 (removed; context grafted here). Production `/npm-registry/*` stays a Netlify Function and the npm client keeps the relative `/npm-registry` base, but the deploy/runtime contract 0028 left implicit is now recorded after a live incident (PR #25): production served `index.html` for `/npm-registry/vite`. Deploys run `netlify build` + `deploy --no-build`; explicit function redirects precede the SPA fallback; upstream env read via `Netlify.env` with `process.env` fallback AND must exist as a site env var; upstream bodies buffered; metadata+tarball smoke runs on every deploy. 0028's open live-smoke acceptance item is closed with live evidence.

## Context (grafted from ADR-0028)

- ADR-0005 keeps registry access behind a same-origin `/npm-registry` route; dev = Vite proxy. Prod needs the same route shape: direct browser calls to `registry.npmjs.org` from a cross-origin-isolated page can fail CORS/CORP, and hardcoded external registry URLs in consumers violate D-004.
- Production host = Netlify (`.github/workflows/netlify.yml`, `netlify.toml`); the proxy must be tested on the same deploy path the workflow publishes.
- 0028 options: **A — Netlify Function (chosen, stands):** same provider as the deploy, one checked-in function, route config in code, upstream from env. **B — Netlify redirect straight to npmjs (rejected):** no tested handler seam for method policy, CORS/CORP headers, env-driven upstream. **C — separate Worker/proxy host (rejected):** splits deployment and operator state across providers.
- Handler policy stands: `netlify/functions/npm-registry.mts`, route `config.path` for `/npm-registry` + `/npm-registry/*`; forwards only `GET`/`HEAD`, answers `OPTIONS` 204, 405 otherwise; COI-safe `Access-Control-Allow-Origin: *` + `Cross-Origin-Resource-Policy: cross-origin` on every response.
- `@riftydev/npm-client` keeps the relative `/npm-registry` default — dev and prod differ only by host routing.

## New context — PR #25 incident

Production returned `index.html` for `/npm-registry/vite`. Chain: artefact-only `netlify deploy --dir … --functions …` uploaded a broken modern-function build state → live 502s → SPA fallback rewrote the failing route to the app shell, masking the breakage as 200 HTML. 0028 recorded the function but none of the deploy/routing/env decisions that keep it alive.

## Decision

1. **Deploy pipeline:** `netlify build --filter=@riftydev/playground --context=<deploy-preview|production>` then `netlify deploy --no-build` (preview + prod, `.github/workflows/netlify.yml`). `netlify build` produces correct function build state; artefact-only deploy with `--functions` rejected as broken (the 502 evidence above).
2. **Routing belt-and-suspenders:** explicit redirects `/npm-registry/* → /.netlify/functions/npm-registry/:splat` (+ exact-path variant) BEFORE the SPA fallback in BOTH `apps/playground/public/_redirects` and `netlify.toml`; function `config.path` retained as well. Revises 0028's "direct provider redirects stay out of the production registry path" — its intent (no direct EXTERNAL redirect to npmjs) is preserved and now machine-checked: `tests/integration/prod-npm-registry-proxy.test.ts` asserts `_redirects`/`netlify.toml` contain no `https://registry.npmjs.org` and the proxy rules precede the SPA fallback. Internal function redirects are in.
3. **Env read:** function reads `RIFTY_NPM_REGISTRY_UPSTREAM` via `Netlify.env` with `process.env` fallback (`Netlify.env` absent in local/vitest contexts).
4. **Runtime env:** `[build.environment]` is build-time only; `RIFTY_NPM_REGISTRY_UPSTREAM` must ALSO exist as a Netlify SITE env var for function runtime (set on `rifty-playground` = `https://registry.npmjs.org`; documented in `docs/public/hosting-netlify.md`).
5. **Bodies buffered:** upstream bodies buffered (`await upstream.arrayBuffer()`) before re-wrapping the Response; hop-by-hop/framing headers (`content-encoding`, `content-length`, `transfer-encoding`, …) stripped — fetch transparently decompresses, so pass-through framing headers would lie. Deterministic body over streaming pass-through.
6. **CI deploy smoke:** `tools/netlify/smoke-npm-registry.mjs` runs against the PR preview alias and the production URL on every deploy; smokes `/npm-registry/vite` metadata and a tarball. Closes 0028's open acceptance item and the deploy-smoke backlog item.

## Live evidence (2026-06-13, preview https://pr-25--rifty-playground.netlify.app)

- `GET /npm-registry/vite` → 200 `application/json`, 38.8 MB body through the buffered function (no 6 MB response cap — Netlify Functions v2 stream outward).
- `GET /npm-registry/vite/-/vite-8.0.16.tgz` → 200, valid gzip, untars.

## Consequences

- One production provider path stands; no consumer-side registry URL change (grafted from 0028).
- Function build state is owned by `netlify build`; deploys cannot silently drop functions, and the SPA fallback can no longer mask a registry-route failure — redirects claim the prefix first, CI smoke fails the deploy if the route regresses.
- The no-direct-external-redirect invariant moved from ADR prose to a test assertion.
- Buffering cost = function memory proportional to tarball size — provisional, tracked in `docs/backlog/npm-client/netlify-proxy-buffered-bodies.md`.
- Operator state: the site env var is load-bearing; a fresh Netlify site needs `RIFTY_NPM_REGISTRY_UPSTREAM` set before the proxy works.

## Acceptance criteria

- [x] Function source lives in the playground deploy path. (0028)
- [x] Function sets `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin` on every response. (0028)
- [x] `@riftydev/npm-client` resolves prod URLs through `/npm-registry/...` exactly as dev. (0028)
- [x] Live deployed `/npm-registry/<package>` and tarball round-trip smoked. (0028's open item — closed: CI smoke on every preview/prod deploy + live evidence above)
- [x] Proxy redirects precede the SPA fallback in `_redirects` and `netlify.toml`; no external registry redirect (integration-test asserted).
- [x] Workflow builds functions via `netlify build` and deploys `--no-build`; no `--functions=` artefact upload (integration-test asserted).

## Reversibility classification

**IRREVERSIBLE** — supersedes a recorded ADR (checklist rule 3) and changes the observable deploy/routing contract. Recorded per record-and-continue via a decision subagent.

## Cited ADRs

- ADR-0005 — dev proxy; same-origin `/npm-registry` route shape (D-004)
- ADR-0002 — cross-origin isolation; why responses need CORP/CORS headers
- ADR-0028 — predecessor (removed; README Superseded table points here)
