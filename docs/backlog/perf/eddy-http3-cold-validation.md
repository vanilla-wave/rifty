---
area: perf
status: draft
title: Validate eddy ~6x on a real browser over HTTP/3
created: 2026-06-28
why: the ~6x headline assumes the bundled single stream beats the per-origin single-h2 tarball phase; HTTP/3 (advertised via alt-svc, untested) could lift the single-connection ceiling and narrow eddy's edge — the number must be measured on the real transport before it is quoted
user_story: As the maker quoting an eddy speed number at launch I want it measured on a real Chromium tab over the actual transport (h2/h3), but today the ~6x is from a Node/sandbox model and the h3 path is unmeasured.
epic: fast-install-resolver
blocked_by: [perf/cold-start-and-install-benchmark]
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/backlog/perf/reference/speed-benchmarks.md]
---

## Context

Adversarial measurement established the structure (standard ~4s; eddy ~0.6-0.7s; ~6x) but on a Node/sandbox transport. The faithful browser path is ONE coalesced h2 connection per origin, where the tarball phase is single-connection-bound. The open risk (ADR-0182 "Open validation"): a real browser uses HTTP/3/QUIC (alt-svc advertised on the prod CDN, untestable from Node/curl here) which could raise the single-connection ceiling and shrink standard-path A's gap to eddy's bundle — narrowing the ~6x.

**The engine + client are now built** (`@riftydev/eddy` + `InstallOptions.resolverUrl`, parity-proven offline). What this item still needs is a real-browser measurement, and it remains blocked + non-trivial for THREE reasons, all outside this repo's current reach:

1. **No harness.** `perf/cold-start-and-install-benchmark` (the `blocked_by`) is unbuilt — there is no `pnpm bench`, no real-Chromium install-timing runner, no committed JSON artifact. That must land first.
2. **No deployed eddy.** A faithful measurement needs the client pointed at a *deployed* eddy on the prod CDN (confirm-first/outward, `distribution/eddy-package-and-deploy`); the offline fixture path doesn't exercise the browser's single-connection transport.
3. **No h3 control.** Chromium picks h2 vs h3 itself (alt-svc / connection racing); Playwright exposes no per-request transport pin, so "measure over h2 AND h3" is not forceable from the current e2e infra.

Until then the quoted ~6x stays an explicitly-**unvalidated-on-real-h3** figure (recorded as such in ADR-0182 "Open validation"); never quote it as measured.

## Open forks (resolve to reach ready)

- Harness: extend `perf/cold-start-and-install-benchmark`'s (future) real-Chromium harness to measure (a) standard cold install and (b) eddy fast install for the same dep-set, over both h2 and h3, median-of-N, fresh profile — once a deployed eddy URL exists.
- Decision rule: if h3 narrows the gap below a threshold, re-weight eddy's headline (or re-scope the bundle vs lockfile-only tradeoff) — record the decision.
- Emit the measured eddy number to the committed benchmark artifact; quote conservatively rounded.
- REVERSIBLE — measurement + recorded decision (CHANGELOG line). No ADR.
