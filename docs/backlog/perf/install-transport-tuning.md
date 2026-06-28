---
area: perf
status: draft
title: Install transport tuning (HTTP/3, fetch concurrency, preconnect)
created: 2026-06-28
why: connection-level wins are cheap ride-alongs but only matter if the connection layer is actually a cold-install bottleneck — must be gated on measurement, not assumed
user_story: As a developer on a high-latency link, I want DNS/TLS and request multiplexing off the install critical path, but today TLS setup happens lazily at first fetch and fetch concurrency is capped at 8.
epic: cold-npm-install-speedup
blocked_by: [perf/cold-install-metadata-reprofile]
sources: [https://developers.cloudflare.com/speed/optimization/protocol/http2-to-origin/, https://blog.apnic.net/2022/11/30/http-3-and-quic-prioritization-and-head-of-line-blocking/, https://blog.cloudflare.com/even-faster-connection-establishment-with-quic-0-rtt-resumption/]
code: [deploy/yandex/npm-registry/Caddyfile, packages/npm-client/src/installer.ts, apps/playground/index.html]
---

## Context

Three small transport levers, each preserving the determinism invariant (transport/IO only, never placement):

1. Enable HTTP/3 on Caddy (`protocols h1 h2 h3`) to cut head-of-line blocking on the many parallel metadata fetches.
2. Raise `PACKUMENT_CONCURRENCY` / `FETCH_CONCURRENCY` (`installer.ts`, both 8) IF real per-level sibling fan-out exceeds 8 — otherwise raising the cap is dead weight.
3. `<link rel=preconnect crossorigin>` to the registry origin in the playground `<head>` so DNS+TLS leave the critical path before `walkAndPin` (origin from `getRegistryBaseUrl`, never hardcoded — D-004).

## Open forks (resolve to reach ready)

- Each lever is gated on the re-profile showing the connection layer is a bottleneck (fan-out > 8, or RTT setup on the critical path). Individually low impact.
- A perf-regression test must keep `peakInFlight` rising while the express-diamond layout (`ms@2.1.3` flat / `ms@2.0.0` nested) stays pinned.
- REVERSIBLE (config + a perf knob) → CHANGELOG; no ADR.
