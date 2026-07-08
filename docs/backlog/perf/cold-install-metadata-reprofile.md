---
area: perf
status: draft
title: Re-profile cold install after abbreviated packuments
created: 2026-06-28
why: the choice between the deeper install levers depends on whether residual cold-install time is bytes-bound or RTT-count-bound — unmeasured after corgi, and the old profile predates ADR-0175/0176
user_story: As the maintainer picking the next install-speed lever, I want the post-corgi cold-install wall-time decomposed into transfer-bytes vs round-trip-count, but today only a pre-corgi profile exists and the baseline has shifted under prefetch + CDN cache.
epic: cold-npm-install-speedup
blocked_by: [npm-client/abbreviated-packuments]
sources: [docs/backlog/perf/reference/speed-benchmarks.md]
---

## Context

The 2026-06-24 profile (~98% serial packument waterfall) predates ADR-0175 (client prefetch), ADR-0176 (CDN cache), and abbreviated packuments. After corgi ships, residual cold-install cost is dominated by EITHER transfer BYTES (→ corgi may suffice, or a static metadata blob helps) OR round-trip COUNT = dependency-graph depth (→ only a server-side full-closure resolver collapses it). This item re-decomposes the post-corgi cold install along that bytes-vs-RTT axis and records the decision in the epic, promoting exactly one downstream lever to `ready` and dropping/parking the others.

Clean boundary vs the `pnpm bench` harness (delivered — the launch headline numbers): this item reuses that harness for a per-axis decomposition that exists only to gate the next lever. Output is a measurement + a recorded decision, not a feature.

FINDING (adversarial measurement 2026-06-28, faithful browser transport): BOTH the metadata waterfall (~2s) AND the tarball-fetch phase (~1.7-2.2s) are latency-bound — abbreviated packuments cut bytes ~2.5x but ZERO wall-time, and raising the fetch semaphore is inert (one coalesced h2 connection per origin). The structural cold-install win is therefore the delivered eddy resolver (ADR-0182), not the cheap levers in this epic. The 2026-07-07 transport measurement recorded the production headline as `auto` h2 (standard 5180ms → eddy 2761ms = 1.88x); direct-origin forced h3 exists but is not the production CDN path.

## Open forks (resolve to reach ready)

- Instrumentation: count distinct packument requests, sum metadata bytes transferred, and measure critical-path RTTs (graph depth) on express@^4 + eslint@^9 against the deployed `registry.rifty.dev` (D-004), corgi enabled.
- Decision rule: bytes-dominant → favor `bundled-popular-subgraph-metadata` (or stop at corgi); RTT-dominant → favor `server-side-closure-resolver`; connection-dominant → a new transport item only if the production CDN path can actually negotiate h3 (the eddy launch measurement found it stayed h2).
- REVERSIBLE — measurement + recorded decision (CHANGELOG line). No ADR.
