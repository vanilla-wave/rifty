# ADR 0176: Cache headers for npm registry proxy

Status: Accepted
Date: 2026-06

> TL;DR: the Yandex Caddy npm proxy now emits CDN-ready cache headers:
> immutable tarballs, short-lived packuments, and `Vary: Accept`.

## Context

- ADR-0163 moved production registry traffic to a streaming Yandex Compute proxy
  but left it as transparent pass-through with no cache policy.
- Measurements showed repeat packument traffic through the proxy is much slower
  than npm's Fastly edge when every package metadata request is a cold upstream
  miss.
- Caching must not transform npm payloads. The proxy stays a streaming
  pass-through; it only annotates responses for an external cache/CDN.

## Decision

1. Tarball paths under `/npm-registry/.*/-/.*.tgz` get
   `Cache-Control: public, max-age=31536000, immutable`.
2. Packument paths under `/npm-registry/<name>` and `/npm-registry/@scope/<name>`
   get `Cache-Control: public, max-age=300, stale-while-revalidate=86400`.
3. Packuments also get `Vary: Accept`, so future abbreviated packuments and full
   packuments cannot share the same CDN object.
4. The checked-in standalone Caddyfile and the inline Caddyfile in
   `docker-compose.yml` carry the same rules.
5. Caddy serves both `registry.rifty.dev` and `registry-origin.rifty.dev`; the
   latter stays pinned to the VM so CDN can use it as origin without looping
   back through `registry.rifty.dev`.
6. On 2026-06-26, after explicit infra confirmation, `registry.rifty.dev` was
   switched to Yandex Cloud CDN resource `bc8rt27zbc2ycfeghqjn`. DNS now points
   at provider CNAME `409f80b3d8827091.topology.gslb.yccdn.ru`; the origin stays
   `registry-origin.rifty.dev`.

## Consequences

- The CDN in front of `registry.rifty.dev` can cache immutable tarballs safely.
- Packument staleness is bounded to five minutes plus background revalidation.
- First-ever package requests still miss upstream; ADR-0175 addresses client-side
  waterfall latency independently.
- A first CNAME switch on 2026-06-26 was rolled back because the CDN edge still
  served the default `*.yccdn.cloud.yandex.net` certificate. The successful
  switch waited until a direct edge probe served the managed `registry.rifty.dev`
  certificate.

## Acceptance criteria

- [x] Integration config test asserts tarball and packument cache rules.
- [x] `Vary: Accept` is pinned on packument responses.
- [x] No registry URL or payload rewriting is introduced.

## Reversibility classification

**IRREVERSIBLE** — production cache policy affects operator-owned registry
infrastructure and extends ADR-0163. Recorded per record-and-continue.

## Cited ADRs and docs

- ADR-0163 — Yandex Cloud streaming npm-registry proxy.
- ADR-0175 — client-side packument prefetch.
- `docs/process/decision-workflow.md` — confirm-first for outward infra actions.
