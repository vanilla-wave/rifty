# ADR 0028: Netlify Function proxies npm registry in production

Status: Accepted
Date: 2026-05

> TL;DR: production `/npm-registry/*` is a Netlify Function backed by `RIFTY_NPM_REGISTRY_UPSTREAM`; the npm client keeps the same relative `/npm-registry` base as dev.

## Context

ADR-0005 keeps npm registry access behind a same-origin `/npm-registry` route.
Dev uses Vite's proxy. Prod needs the same route shape because direct browser
calls to `registry.npmjs.org` from a cross-origin-isolated playground can fail
CORS/CORP checks, and hardcoding external registry URLs in consumers violates
D-004.

The playground production host is Netlify (`.github/workflows/netlify.yml` and
`netlify.toml`). A production proxy must therefore be tested on the same deploy
path the workflow publishes.

## Options considered

- **A — Netlify Function (chosen).** Same provider as the playground deploy,
  one checked-in function, route config in code, upstream from env.
- **B — Netlify redirect to npmjs.** Shorter config, but no tested handler seam
  for method policy, CORS/CORP headers, or env-driven upstream changes.
- **C — Separate Worker/proxy host.** Equivalent runtime shape, but splits
  deployment and operator state across providers.

## Decision

Production `/npm-registry` is served by `netlify/functions/npm-registry.mts`
using a Netlify Function route config for `/npm-registry` and `/npm-registry/*`.
The function reads `RIFTY_NPM_REGISTRY_UPSTREAM` via `Netlify.env`; `netlify.toml`
sets the repo default for the checked-in playground site. The handler preserves
the dev route shape, forwards only `GET`/`HEAD`, handles `OPTIONS`, and sets
COI-safe CORS/CORP headers on every response.

`@riftydev/npm-client` keeps the same relative default `/npm-registry`, so dev
and prod differ only by host routing.

## Consequences

- One production provider path: Netlify workflow, Netlify config, Netlify function.
- No consumer-side registry URL change.
- Direct provider redirects stay out of the production registry path.
- Live deploy round-trip remains confirm-first/outward and is tracked by the
  deploy-smoke backlog item.

## Acceptance criteria

- [x] Function source lives in the playground deploy path.
- [x] Function sets `Access-Control-Allow-Origin: *` and
  `Cross-Origin-Resource-Policy: cross-origin` on every response.
- [x] `@riftydev/npm-client` resolves prod URLs through `/npm-registry/...`
  exactly as dev.
- [ ] Live deployed `/npm-registry/<package>` and tarball round-trip smoked.
