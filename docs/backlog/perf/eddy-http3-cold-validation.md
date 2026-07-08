---
area: perf
status: ready
title: Validate the eddy launch speed number on a real browser over HTTP/3
created: 2026-06-28
why: the committed production `auto` artifact shows 1.88x over h2, but it does not carry the full h2/h3 transport matrix evidence; h3 must stay unquoted until the matrix is committed
user_story: As the maker quoting an eddy speed number at launch, I want the production headline backed by a real Chromium transport artifact, and I want h2/h3 claims either evidenced or explicitly unquoted.
epic: fast-install-resolver
blocked_by: []
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/backlog/perf/reference/speed-benchmarks.md, docs/public/hosting-eddy.md]
code: [tools/perf/bench.mjs, tools/perf/src/aggregate.mjs, perf/benchmarks.json]
---

## Context

The current committed benchmark records production `auto`: standard 5180ms →
eddy 2761ms = **1.88x**, with both production origins observed as h2. That is
the only quotable browser headline in the tree today. The committed artifact
does not contain `transportMatrix.{auto,h2,h3}.{standard,eddy}` phase evidence,
so h2/h3 comparison numbers cannot close this item.

The matrix tooling exists in `tools/perf/bench.mjs` and the aggregation core
enforces pin evidence with `verifyTransportPin`. This item remains open until
the artifact itself proves the matrix or the h3 branch is recorded as
unmeasured.

## Acceptance

- `perf/benchmarks.json` carries phase-local transport evidence for the full
  matrix: `transportMatrix.auto`, `transportMatrix.h2`, and
  `transportMatrix.h3`, each split into `standard` and `eddy` phases with
  per-run request counts and probed protocols.
- The production headline is derived from the `auto` eddy-vs-standard row.
- Any h2/h3 row lacking positive protocol proof is `unmeasured` with evidence
  and a note; no h2/h3 median is quoted from a refused row.
- ADR-0182, `docs/public/hosting-eddy.md`, and the changelog name only the
  artifact-supported headline.
- Once the matrix artifact is committed, update this epic's outcome and delete
  this item per delete-on-done.

## Fault Matrix

| Fault | Expected outcome | Proof |
|---|---|---|
| Forced h3 cannot reach an origin | h3 row records `unmeasured`, no h3 median quoted | `transportMatrix.h3` note + per-run evidence |
| Browser negotiates the wrong protocol under a pin | Row refused, evidence retained | `verifyTransportPin` unit + artifact row |
| Pinned run makes zero measured-origin requests | Row refused as vacuous proof | `verifyTransportPin` unit |
| Eddy pass falls back to standard install | Eddy row refused; no `speedupX` for that row | terminal proof `via eddy (fast)` |

## Parity cases

N/A — measurement tooling and operator transport behavior, no Node-observable
runtime behavior.

## Out of scope

- Serving or tuning HTTP/3 itself.
- Non-Chromium browsers.
- `curl --http3` as the quoted browser benchmark.

## Decisions

- PIN + VERIFY remains the contract: launch args choose h2/h3, CDP evidence
  proves what was actually used.
- REVERSIBLE — measurement + documentation. No ADR.
