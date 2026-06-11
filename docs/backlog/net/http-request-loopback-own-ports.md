---
area: net
status: active
title: http.request/get loopback to locally registered server ports
created: 2026-06-11
why: client requests to a host:port matching a locally registered server unconditionally hit real fetch() and fail on CORS/DNS — breaks supertest, health-checks, and self-calls that real Express/Vite projects rely on
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md]
code: [packages/net/src/http/server.ts, packages/net/src/http/request.ts]
---

## Context

`http.request()` / `http.get()` call `fetch()` unconditionally, with no check against the port
registry. Real Node apps and their test suites constantly hit their own server (supertest, readiness
probes, internal service-to-service, proxies); today those silently escape to the real network and
fail on CORS/DNS. Small, pure in-process, and squarely on the M11 "runs real-ish projects" theme.

## Options or Next

- Before falling through to `fetch()`, check whether host:port matches a registered server port; if
  so, route through `dispatchToPort` (the SW-preview path already uses the same registry).
- Preserve real-`fetch()` egress for genuinely external hosts — key strictly on the port registry.
- Cover both `http.request` and `http.get`; add a conformance case (`server.listen` → `http.get` own
  port → 200).

## Reversibility

REVERSIBLE — a routing branch in the request path; no public API change. Recorded here.
