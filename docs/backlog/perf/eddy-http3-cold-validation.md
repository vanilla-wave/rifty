---
area: perf
status: draft
title: Validate the eddy launch speed number on a real browser over HTTP/3 (warm h2 = 1.70x; h3 unmeasured)
created: 2026-06-28
why: warm h2 is measured at 1.70x (the launch number); the historical ~6x is a Node/sandbox model that assumed the bundled single stream beats the per-origin single-h2 tarball phase. HTTP/3 (advertised via alt-svc, untested) could lift the single-connection ceiling and shift the measured number — it must be confirmed on the real transport before any h3 figure is quoted.
user_story: As the maker quoting an eddy speed number at launch I want it measured on a real Chromium tab over the actual transport (h2/h3); warm h2 is 1.70x today and the h3 path is unmeasured (the "~6x" is a Node/sandbox model, never the launch quote).
epic: fast-install-resolver
blocked_by: []
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/backlog/perf/reference/speed-benchmarks.md]
---

## Context

Adversarial measurement established the structure (standard ~4s; eddy ~0.6-0.7s; ~6x) but on a Node/sandbox transport. The faithful browser path is ONE coalesced h2 connection per origin, where the tarball phase is single-connection-bound. The open risk (ADR-0182 "Open validation"): a real browser uses HTTP/3/QUIC (alt-svc advertised on the prod CDN, untestable from Node/curl here) which could raise the single-connection ceiling and shrink standard-path A's gap to eddy's bundle — narrowing the ~6x.

**Engine + client + harness + a deployed eddy now ALL exist** — the two original blockers (no harness, no deployed eddy) are resolved and the real-browser number is measured (see below). ONE reason keeps this open, and it is outside the current e2e reach:

- **No h3 control.** Chromium picks h2 vs h3 itself (alt-svc / connection racing); Playwright exposes no per-request transport pin, so "measure over h2 AND h3" is not forceable from the current e2e infra. The measured 1.70x is whatever Chromium negotiated (likely h2); the h3 delta — the actual open risk in ADR-0182 "Open validation" — is still unmeasured.

Until the h3 delta is measured, the h3 leg stays explicitly **unvalidated** (per ADR-0182 "Open validation"); the warm-h2 1.70x below IS measured and quotable.

## Measured (2026-07-01) — 2 of 3 blockers cleared

Blockers 1 (harness) + 2 (deployed eddy) are now RESOLVED: `pnpm bench` measures a standard-baseline + eddy pass with a nested `speedupX` (`perf/benchmarks.json`), pointed at the live `registry.rifty.dev` + `eddy.rifty.dev`.

- **First real-browser number** (`real-vite` preset, warm, median-of-5, one discarded warm-up): standard **4284ms** → eddy **2517ms** = **1.70x**. eddy is deterministic (2266–2518, one bundle POST); the variance is all in the standard baseline (packument+tarball waterfall). Structural: **~100 network round-trips → 1 POST**.
- **The ~6x does NOT hold on warm h2** — it was a Node/sandbox model. The metric shares the ~vite-boot (~0.5s, in both), and the standard baseline rides a WARM single-h2 proxy connection (not the 4s cold path the ~6x assumed). Install-only (directional): eddy ~1.3s vs standard ~3.8–7.4s. **Launch headline: quote 1.70x (or the structural 100→1 round-trips), never ~6x.**
- **eddy was BROKEN, not just slow, before this** — the client's lockfile fast path did not replay shadow/user overrides, so eddy's pre-seeded lockfile threw `EBROKENLOCK` on every override package (`vite` → esbuild). Fixed in `@riftydev/npm-client` (`createLockfileSource` override-aware) with a regression test; without it the eddy pass here times out. See memory / `installer.ts`.

**Still open (blocker 3 only): h3 vs h2 control.** Playwright can't pin the transport; the 1.70x above is whatever Chromium negotiated to `*.rifty.dev` (likely h2). Measuring the h3 delta + the decision rule below remain.

**Folded here (2026-07-01, ex `perf/install-transport-tuning`):** of that item's three levers, the fetch-semaphore raise was DROPPED (measured inert — one coalesced h2 connection per origin) and `<link rel=preconnect>` SHIPPED (ADR-0195: playground boot preconnects the registry + resolver origins, env-config only). h3 — the only remaining transport lever; Caddy serves it natively (`protocols h1 h2 h3`) — lives HERE. Re-baseline with `pnpm bench` before attributing any delta to h3: ADR-0195 (preflight-free POST, pinned GET-by-hash, owner-boot prefetch, streaming unpack) and ADR-0187 (non-blocking stamp) each cut the eddy path's non-transport share after the 1.70x measurement.

## Open forks (resolve to reach ready)

- h3 control: force (or at least distinguish) an h3 vs h2 negotiation for the eddy bundle POST + the standard tarball phase, so the h2-vs-h3 delta is measurable — the last gap the `pnpm bench` harness (delivered) can't yet cover.
- Decision rule: if h3 narrows the gap below a threshold, re-weight eddy's headline (or re-scope the bundle vs lockfile-only tradeoff) — record the decision.
- REVERSIBLE — measurement + recorded decision (CHANGELOG line). No ADR.
- (Done) harness built + eddy deployed + warm-h2 number emitted to `perf/benchmarks.json` — see Measured above.
