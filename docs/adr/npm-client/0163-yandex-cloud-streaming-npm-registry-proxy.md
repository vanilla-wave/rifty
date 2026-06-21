# ADR 0163: Yandex Cloud streaming npm-registry proxy

Status: Accepted
Date: 2026-06

> TL;DR: supersedes ADR-0133 (removed; context grafted here). Production npm
> registry traffic moves from Netlify Functions to a Yandex Cloud Compute VM
> running Caddy as a streaming reverse proxy at `https://registry.rifty.dev`.
> Netlify stays the static deploy target for the landing/playground only.

## Context

- The playground is still cross-origin-isolated (ADR-0002), so registry
  responses used by the browser need explicit CORS/CORP headers.
- ADR-0133's Netlify Function route worked but kept npm traffic on Netlify,
  contrary to the current hosting split: costly/proxy work should live in
  Yandex Cloud while Netlify keeps Git-triggered static deploys.
- Yandex Cloud Functions/API Gateway/Serverless Containers were rejected for
  this proxy: their documented HTTP/JSON response limits are 2.5-3.5 MB, while
  real npm packuments can be tens of MB (`vite` was live-smoked at 38.8 MB in
  ADR-0133). A serverless JSON proxy would silently fail real workloads.
- Direct browser calls to `registry.npmjs.org` stay rejected. They would bypass
  the controlled CORS/CORP policy and reintroduce hardcoded external registry
  routing in the playground path (D-004).

## Decision

1. Production registry base is `https://registry.rifty.dev/npm-registry`.
   `netlify.toml` sets `VITE_RIFTY_REGISTRY_URL` for the production playground
   build; local dev keeps the relative `/npm-registry` Vite proxy from ADR-0005.
2. `registry.rifty.dev` is served from Yandex Cloud Compute, not Netlify and not
   serverless. The checked-in deploy surface is
   `deploy/yandex/npm-registry/docker-compose.yml`, running Caddy on a Container
   Optimized Image VM.
3. Caddy handles only `GET`, `HEAD`, and `OPTIONS`; returns 405 with `Allow` for
   other methods; sets `Access-Control-Allow-Origin: *` and
   `Cross-Origin-Resource-Policy: cross-origin` on every response; and streams
   `/npm-registry/*` to `https://registry.npmjs.org/*` after stripping the
   prefix.
4. Netlify no longer owns `/npm-registry/*`: the Function source and Netlify
   redirects are removed. GitHub deploy smoke now calls
   `tools/registry/smoke-npm-registry.mjs https://registry.rifty.dev`, checking
   both metadata and a tarball through the Yandex proxy.
5. DNS remains in Yandex Cloud DNS. `registry.rifty.dev` points to the proxy VM
   public address; `rifty.dev`, `www.rifty.dev`, and `play.rifty.dev` continue
   to point at Netlify.

## Consequences

- The production npm path is a true streaming proxy, so large packuments and
  tarballs are not constrained by serverless response JSON limits.
- Netlify deploys are simpler: static playground artifact + COOP/COEP headers,
  no Functions build state or runtime env var.
- There is now a small always-on Compute VM cost and operator surface:
  public IP, security group, Docker/Caddy runtime, and DNS record.
- Caddy obtains/renews the TLS certificate automatically. VM recreation needs
  the same docker-compose file and a DNS update to the new public IP.

## Acceptance criteria

- [x] Netlify Function source removed; Netlify redirects no longer claim
  `/npm-registry`.
- [x] Playground production build uses `VITE_RIFTY_REGISTRY_URL`.
- [x] Checked-in Yandex deploy config streams through Caddy and sets CORS/CORP.
- [x] CI deploy smoke targets `https://registry.rifty.dev`.
- [x] Live `registry.rifty.dev` metadata + tarball smoke passes after VM/DNS
  creation.

## Reversibility classification

**IRREVERSIBLE** — supersedes a recorded production deploy/routing ADR and
changes operator-owned infrastructure. Recorded per record-and-continue.

## Cited ADRs and docs

- ADR-0002 — cross-origin isolation and COEP/CORP pressure.
- ADR-0005 — dev `/npm-registry` Vite proxy remains.
- ADR-0133 — predecessor (removed; README Superseded table points here).
- Yandex Cloud Functions "Quotas and limits" official page (checked
  2026-06-21).
- Yandex API Gateway "Quotas and limits" official page (checked 2026-06-21).
