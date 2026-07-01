---
area: perf
status: draft
title: Lower eddy's steady-state install floor (client extraction) + kill cold spikes (host)
created: 2026-07-01
why: eddy's warm install-only median is ~1.05s, and profiling shows it is NOT network (1 POST) but the client-side extraction floor (gunzip + non-disableable sha512 integrity + OPFS small-file writes) that both install paths share — the ~2.9x measured is capped by this floor, and no host tuning moves it
user_story: As the maker quoting eddy speed, I want the ~1s client-side install floor decomposed and lowered (and the occasional multi-second cold spike removed), so the eddy fast path approaches its ceiling instead of stalling on browser extraction cost.
epic: fast-install-resolver
blocked_by: []
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, perf/benchmarks.json]
code: [packages/npm-client/src/installer.ts, apps/playground/src/glue/npm-shell-command.ts, services/eddy/src/cache.ts]
---

## Context

Measured 2026-07-01 (PR #104, live `registry.rifty.dev` + `eddy.rifty.dev`, `real-vite`, warm, median-of-5): eddy vs standard install-only **1050ms vs 3033ms ≈ 2.9x** (install→vite-ready 2517 vs 4284 = 1.70x — the shared ~vite-boot dilutes it). eddy uses ONE POST (vs ~100 round-trips), so its ~1s is NOT network: it is the client-side extraction floor BOTH paths pay — gunzip of the 12 `.tgz` (~7MB bundle), non-disableable sha512 integrity per tarball, and hundreds of small-file writes into OPFS. Inferred split: fixed extraction ~1.0s (both) + network waterfall ~2.0s (standard only). Ceiling on the ratio = `(fixed+waterfall)/fixed`; while `fixed ≈ 1s` dominates on warm h2 + a small tree, the ratio is capped ~2.9x. The ~6x model was Node/sandbox (overstated standard cold ~4s, understated real-browser eddy ~0.6s vs measured ~1.0s).

Two distinct problems:

1. **Steady-state floor (~1s, CLIENT).** Host tuning (server CPU/network/egress) can NOT move it — the work is in the browser worker. Not yet PROFILED: the fetch / gunzip / sha512-integrity / OPFS-write split within the ~1s is inferred, not measured. Profile FIRST (add stage timers to the eddy install path), then optimize whatever dominates — likely OPFS small-file writes (see `perf/opfs-writefilesync-shared-slice`) and/or serial gunzip+integrity.

2. **Cold spikes (multi-second, HOST).** One of five eddy runs hit 5103ms — a Cloud-Run instance cold-start / mutable-tier miss, not the steady path. Host config DOES fix this: `min-instances ≥ 1` (no scale-to-zero), a long mutable-tier TTL (`EDDY_TTL_SECONDS`, `services/eddy/src/cache.ts`) + the immutable `closure-hash → bundle` tier on the CDN edge (`Cache-Control: immutable`) so warm hits never recompute; more server CPU only speeds a cache-MISS `resolveBundle`, never a warm hit.

## Open forks (resolve to reach ready)

- **Profile** the client eddy path (`installer.ts` `tryEddyFastPath` → seed → fast-path extract) with per-stage timers (fetch, unpack tar, integrity, gunzip, OPFS write) on a real browser; publish the split before choosing a lever. No silent optimization of an unprofiled floor.
- **Client levers** (pick by the profile): batch/coalesce OPFS writes (`perf/opfs-writefilesync-shared-slice`), parallelize gunzip+integrity across workers, or a more compact bundle format — but ADR-0182 deliberately chose variant B (lockfile + original gzip tarballs; extracted-tree + brotli rejected), so any format change reopens that ADR.
- **Host lever:** decide + document the deploy knobs (min-instances, TTL, CDN immutable) that remove the cold spike — a `distribution/eddy-package-and-deploy` config concern, cross-link there. See also `perf/eddy-http3-cold-validation` (h3 is a separate, marginal transport question).
- REVERSIBLE — measurement + code/config tuning (CHANGELOG line). A bundle-format change would need an ADR-0182 revision.
