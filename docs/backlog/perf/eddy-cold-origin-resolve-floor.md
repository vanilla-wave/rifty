---
area: perf
status: draft
title: eddy cold-origin resolve floor — server-side levers for unseen dep sets
created: 2026-07-02
why: first-ever POST for an arbitrary dep set (express+eslint, 137 pkgs) takes 17.3s through the deployed stack — WORSE than the warm-edge standard path (7.1s); the fast path must not be a cold-path regression
user_story: As a playground user typing `npm install express eslint` I want the eddy fast path to win even when nobody resolved that set before, but today the first resolve is slower than the standard waterfall.
epic: fast-install-resolver
blocked_by: []
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, services/eddy/src/resolver.ts, services/eddy/src/cache.ts]
---

## Measured (2026-07-02, install-only, express+eslint = 137 pkgs, probe fresh-profile, printed unquantized ms)

- standard browser path: cold registry-CDN edge **24.2s**, warm edge **~7.1s** median (outlier 11.3s); 278 requests.
- eddy POST warm origin: **0.88s** median (raw POST: TLS 0.15s + TTFB 0.07s + 2.9MB transfer ~0.5s) → **8.1×** vs warm standard.
- eddy POST cold origin (unseen set): **17.3s** — server runs the same `install()` walk against `REGISTRY_BASE_URL=https://registry.rifty.dev/npm-registry` (browser-CORS proxy, cold edges) with per-call caches.
- repeat install same profile (lockfile replay): **57ms**, 0 network. Client floor is negligible; everything is network.
- local resolver experiments (direct npmjs upstream): cold resolve **5.6–6.3s**; concurrency 8→32 ≈ −10% (walk is graph-depth/discovery-bound, avg ~6 requests in flight); corgi packuments halve bytes (11.8→4.9MB) but wall-time unchanged. RTT-chains dominate, not bytes, not semaphore.

## Levers (ranked)

1. **Cross-request packument cache in the server** — `createRegistrySource` news a per-`install()` cache; eddy calls `resolveBundle` per request with a fresh memory VFS, so EVERY cold set re-fetches all packuments. A process-wide packument cache (TTL policy decision: e.g. = mutable-tier TTL, or shorter) collapses cold-SET resolve to ~tarball time for sets overlapping anything seen before. Biggest win, server-only, no wire change. (Server-side twin of `npm-client/persisted-packument-store`; corgi is orthogonal — `npm-client/abbreviated-packuments` already records bytes-only, re-confirmed today at 137-pkg scale.)
2. **Upstream A/B from the VM** — CDN proxy (`registry.rifty.dev`) exists for browser CORS; the server needs no CORS. Direct `registry.npmjs.org` avoids cold-edge double hops, BUT RU-region routing to npmjs needs measurement ON the VM before switching (may be slower/throttled). Measure both, pick per data.
3. **Resolve-only TTL refresh** — mutable tier expires in 1800s; recompute re-downloads all tarballs into a fresh VFS even when the closure is unchanged. Resolution needs packuments only (integrity comes from packument dist); if recomputed closureHash hits the immutable tier, skip tarball fetches entirely.
4. **Bundle store = Object Storage behind the CDN; origin stateless** — REPLACES both the in-process immutable LRU (256 entries × 3–7MB ≈ up to ~1.5GB RSS risk) and any VM-disk idea. POST wire unchanged: origin streams the bundle inline AND async-writes `bundles/<npmClientVersion>/<closureHash>` to the bucket off the critical path; `eddy-cdn.rifty.dev` origin re-points VM → bucket, the VM stops serving GET bytes. Content-addressed immutable = perfect CDN fit (no invalidation). Origin keeps only reconstructible RAM caches (mutable links, packuments) → hosts >1 scale trivially (no shared disk, no sticky routing; per-host recompute once per TTL is cheap with lever 3, shared KV only if it ever hurts), deploys/restarts lose nothing, egress moves off the VM. Known trade (measured 2026-07-01): CDN GET +0.8s vs direct origin from an EU vantage — CDN buys offload+durability, not latency everywhere; already accepted for pins. Corrupt/missing object self-heals: client-side verify fails → POST → re-resolve re-seeds.
5. **Walk concurrency bump server-side** — minor at DC RTTs (measured −10% locally), cheap; only after 1–2 land.

## Acceptance

- Cold-origin POST for an unseen-but-overlapping dep set (express+eslint after any prior resolve sharing transitive deps) ≤ warm standard path on the same vantage.
- No fidelity trade: bundle lockfile still equals a client live-resolve by construction (same `install()`); packument cache policy recorded (ADR if it changes observable resolution freshness).
- Numbers re-measured via probe (unquantized printed ms), not bench medians.

## Out of scope

- Wire-protocol changes (delta bundles, client-known-tarball exclusion) — separate item if pursued.
- h3 transport (perf/eddy-http3-cold-validation).
