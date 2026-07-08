---
kind: epic
status: ready
title: Cold npm install fast enough to not bounce
created: 2026-06-28
value: A first-time visitor running `npm install` on a real project (no lockfile, cold cache) in a browser tab sees it finish fast enough to stay, not bounce.
user_story: As a developer trying a real project in rifty for the first time, I want a cold `npm install` to finish quickly, but today it is dominated by a serial full-packument metadata waterfall and I wait too long.
items: [npm-client/abbreviated-packuments, perf/cold-install-metadata-reprofile, npm-client/persisted-packument-store]
---

## Outcome

Mission anchor: real Node software in the browser — `npm install` is the gateway to every real project. Repeat/template installs are already near-optimal (lockfile fast path ADR-0023 + baked snapshots ADR-0135); the remaining wait is the cold, no-lockfile first run, a measured ~98% of which is the serial packument metadata waterfall (rifty fetches FULL packuments, no abbreviated). This epic removes that wait WITHOUT trading fidelity (the resolved tree stays byte-identical to real npm) or the placement determinism invariant (`walkAndPin` stays serial + request-ordered; only fetch/IO parallelizes). The cheap structural win ships first; a measurement gate then decides whether the deeper levers earn their cost.

## User scenario

A developer opens a from-scratch preset (no lockfile, cold cache), sets a real dep set (e.g. express@^4 + eslint@^9), runs `npm install`, and it completes materially faster than today — the metadata waterfall no longer dominates — while the resulting `node_modules` (versions, `integrity`, `resolved` URLs, layout, lockfile) is byte-identical to real npm / lockfile-replay (parity-proven). Done when abbreviated packuments ship parity-gated AND the post-corgi re-profile has decided, on measured bytes-vs-RTT numbers, whether a deeper lever is pursued (decision recorded, the chosen item promoted to `ready`, the rest dropped or parked).

## Items

- `npm-client/abbreviated-packuments` — corgi `Accept` header; cuts per-packument BYTES ~2.5x. NOTE (measured 2026-06-28): the waterfall is latency-bound — abbreviated does NOT reduce wall-time on a normal connection; it helps slow/metered links + JSON parse only. Cheap, but not the wall-time win it was first billed as. (ready)
- `perf/cold-install-metadata-reprofile` — the decision gate: re-decompose cold-install wall-time into transfer-bytes vs round-trip-count AFTER corgi, on the `pnpm bench` harness (delivered). (draft)
- `npm-client/persisted-packument-store` — cross-session/cross-project metadata reuse for the "new project, same deps, no lockfile" case. (draft)
- ~~`perf/install-transport-tuning`~~ — CLOSED 2026-07-01 from `draft`; per-lever trail: preconnect SHIPPED (ADR-0195, boot preconnects registry + resolver origins, env-config D-004), fetch-semaphore raise DROPPED (measured inert — one coalesced h2 connection per origin; its planned `peakInFlight` perf-regression test died with the knob), the h3 lever closed in the eddy launch measurement (production `auto` stayed h2; direct-origin h3 is not the CDN path).

The structural cold-install win — collapsing both latency-bound waterfalls into one server-resolved bundled fetch — shipped as eddy (ADR-0182), which superseded this epic's former `server-side-closure-resolver` + `bundled-popular-subgraph-metadata` draft items after they were measured + verified. The current production browser headline is 1.88x (standard 5180ms → eddy 2761ms). This epic now holds the cheap, always-on, no-infra levers for the standard path.

Out of scope — levers the research rejected, recorded so they are not re-proposed: global OPFS content-addressable tarball store (doesn't touch the metadata waterfall; tarball bytes already deduped by the ADR-0176 immutable CDN + browser HTTP cache), ETag/`If-None-Match` 304 packument revalidation (npmjs ignores conditional GET, and it saves bytes not RTT), brotli packuments (npmjs already serves gzip; gzip→br delta is low-single-digit on an RTT-bound path), worker-offload decompress (install already runs in a worker-realm; decompress+untar is ~0.1% of wall-time), OPFS bulk-write consolidation into big files (breaks Node `require()` per-file addressability), streaming SRI / never-materialize-full-tarball (integrity needs the full compressed buffer — deferring it is a forbidden silent stub). Already shipped, not items: client packument prefetch (ADR-0175), CDN cache headers (ADR-0176), bounded parallel tarball fetch (Semaphore), lockfile fast path (ADR-0023), baked snapshots (ADR-0135).
