---
area: perf
status: draft
title: eddy upstream registry A/B — direct npmjs vs CDN-proxy, measured on the VM
created: 2026-07-03
why: eddy's cold-origin resolve is RTT-chain-bound (walk is graph-depth-bound; concurrency + bytes already exhausted in v1.2), and the ONE untried server-side lever is the upstream it resolves against — today the deployed VM points `REGISTRY_BASE_URL` at the CDN registry-proxy (built for BROWSER CORS, which the server does not need), paying cold-edge double hops direct npmjs might avoid; this is the last deferred lever from ADR-0194 §Levers-2, currently living only in prose
user_story: As a playground user typing a first-ever `npm install <deps>` I want eddy's cold resolve to take the shortest upstream path, but today it resolves through the browser-CORS CDN proxy (extra edge hops) instead of possibly-faster direct npmjs — untested from the VM, and RU-region routing to npmjs might actually be slower/throttled, so it must be MEASURED before flipping.
epic: fast-install-resolver
blocked_by: [distribution/eddy-package-and-deploy]
sources: [docs/adr/npm-client/0194-eddy-v1-2-stateless-bundle-store-shared-resolve-caches-learned-pins.md, docs/adr/npm-client/0163-yandex-cloud-streaming-npm-registry-proxy.md, docs/public/hosting-eddy.md]
code: [services/eddy/src/bin.ts, deploy/yandex/eddy/docker-compose.coi.yml]
---

## Context

eddy v1.2 (ADR-0194) closed the client-side + server-cache levers on the cold-origin floor: shared packument (TTL) + immutable tarball caches, single-flight per dep-set, stateless Object-Storage bundle store. What v1.2 explicitly did NOT try (ADR-0194 §Levers item 2, deferred) is the **upstream** eddy resolves against.

The deployed VM sets `REGISTRY_BASE_URL=https://registry.rifty.dev/npm-registry` — the Caddy CDN registry-proxy (ADR-0163). That proxy exists to give the BROWSER a CORS-clean, same-origin registry; the eddy SERVER needs no CORS, so it may be paying cold-edge double hops (VM → CDN edge → npmjs) that a direct `REGISTRY_BASE_URL=https://registry.npmjs.org` would skip. The walk is graph-depth-bound (measured: packument concurrency 8→32 ≈ −10%; corgi bytes-only ≈ no wall-time), so RTT-per-hop is exactly what dominates the cold floor — making the upstream hop count the last lever with headroom.

The catch that keeps this a MEASUREMENT, not a flip: RU-region routing from the Yandex VM to `registry.npmjs.org` is unknown — it may be slower or throttled than the (RU-adjacent) CDN proxy. The direction is only decidable on the VM, against the real cold path, with a probe (not bench medians — the 250ms bench grid hides sub-quantum deltas; memory `eddy-prefetch-pitfalls-bench-quantization`).

Deploy-gated: needs the eddy v1.2 image live on the VM (`distribution/eddy-package-and-deploy`) so the two upstreams can be A/B'd from the same vantage with warm caches controlled for.

## Open forks (resolve to reach ready)

- Measure both upstreams from the VM on an UNSEEN dep set (express+eslint class, cold caches, restart between runs), unquantized probe ms: cold-origin resolve time direct-npmjs vs CDN-proxy, ≥3 runs each, report the delta + variance.
- Decision rule: if direct npmjs is materially faster AND not rate-limited under repeated cold resolves, flip `REGISTRY_BASE_URL` on the VM (env-only, one compose line); else keep the CDN proxy and record npmjs as measured-worse-from-RU. Either way the outcome is a recorded decision (CHANGELOG line), not a silent default.
- Trust-boundary note: direct npmjs makes eddy's upstream npmjs itself (mirror-grade already); the CDN proxy shares eddy's + the browser's one upstream/trust boundary (ADR-0163). If the flip wins on latency, confirm it does not fork the trust story — record in `docs/public/trust-model.md` if it does.
- REVERSIBLE — env-config measurement + recorded decision (CHANGELOG line). No ADR (does not contradict ADR-0163: the browser path keeps the proxy; only eddy's server-side upstream is in question).
