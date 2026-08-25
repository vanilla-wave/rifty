---
area: perf
subsystem: toolchain-build
status: draft
title: Committed product-vs-in-realm perf lane for child fs anchors (vite build + express cold start)
created: 2026-08-26
epic: child-fs-rpc-hot-path
blocked_by: [perf/child-fs-perf-artifact-core, perf/child-fs-perf-product-lane, perf/child-fs-perf-in-realm-lane, perf/child-fs-perf-orchestrator]
why: all current numbers live on a throwaway spike branch; the epic's I3 needs a durable rig so every slice proves its effect on the same anchors
user_story: As the epic's acceptance instrument, I want one committed lane that runs the 2180-module vite build and an express cold require-walk in BOTH worlds (product COI child over sync-RPC; single in-realm worker) and reports self-timed numbers, but today the harness is `prototype/` on the spike branch only.
sources: [spike branch t3code/prototype-no-coi-agent-cycle prototype/no-coi-agent-loop/README.md + FINDINGS.md §2b]
code: [tools/perf/child-fs.mjs, tools/perf/child-fs/, tests/browser-unit/fixtures/child-fs-in-realm-worker.ts]
---

## Question

Contract+RED attempt 2 proved this was not one reviewable unit: pure artifact
authority, two physical browser topologies, and failure orchestration had no
single discriminating RED boundary. Re-cut into the four `blocked_by` children;
delete this lineage item after all four absorb it. Pre-demotion Acceptance and
Parity remain verbatim below.

## User scenario

From a clean Chromium profile, run one command against one pinned guest tree.
The first lane opens the real COI playground and executes both anchors in a
kernel-spawned child over owner sync-RPC. The second lane executes the identical
guest bytes in one in-realm Worker. Compare Vite's own `built in Xs` report for
the 2180-module fixture and Express cold `require('express')` start-to-listening.

## Evidence

- Pinned observation (not acceptance proof):
  `git show 1261339acc1d1eb3f864a9a48ed50bf067fe0f02:prototype/no-coi-agent-loop/FINDINGS.md`
  §2b, command from that commit's `README.md`; macOS 25.3.0, bundled Chromium,
  `@playwright/test ^1.49.0`. It records a 2180-module Vite comparison but no
  Express anchor, exact browser version, scenario digest, or robust faults; the
  committed lane must produce those missing proofs and does not treat the spike
  artifact as frozen truth.
- Carrier evidence: `tools/perf/bench.mjs` already owns an isolated strict-port
  Playwright runner and refuses false/incomplete measurements; Playwright 1.60.0,
  Node v24.16.0, pnpm 11.5.2 on 2026-08-26.
- Expected RED: `pnpm vitest run tools/perf/src/child-fs-artifact.test.ts
  tools/perf/src/child-fs-runner.test.ts` on Vitest 2.1.9 → 9/9 tests fail
  because `child-fs-artifact.mjs` / `child-fs-runner.mjs` do not exist. The
  collected tests enumerate every Acceptance/Parity/Fault rejection below;
  implementation has not started.

## Acceptance

- `pnpm bench:child-fs -- --runs 1 --out <path>` owns a strict playground port,
  runs both anchors in `product-coi` and `in-realm`, and writes one versioned JSON
  artifact only after both lanes complete.
- Both lanes consume one canonical guest tree and dependency declaration. The
  artifact records one scenario digest and rejects lane-reported digests or
  dependency identities that differ.
- Every completed run records Vite's self-timed seconds, exact transformed-module
  count (`2180` for the pinned fixture), and Express start-to-listening ms. Raw
  samples remain present; no pass/fail multiplier is invented.
- The runner records git SHA, Chromium version, lane topology, and loaded-owner
  mode. `--runs N` accepts only N complete samples per anchor and lane; a timeout,
  failed child, missing/duplicate marker, stale build marker, or partial sample
  exits non-zero without publishing a success artifact.
- The lane can emit a baseline artifact before a product slice and an after
  artifact on the same rig; each landed goal slice records both summaries in the
  goal ledger.

## Parity cases

- `vite-2180`: identical scenario digest and dependency identities; both lanes
  report exactly 2180 transformed modules, a successful exit, a fresh marker in
  emitted JS, and one self-timed `built in Xs` value per run.
- `express-cold-listen`: identical guest source; a fresh execution reports one
  duration from before `require('express')` through the listening callback,
  closes the server, and exits 0 in both lanes.
- `sample-identity`: lane labels/topologies, run ordinal, browser version, git
  SHA, owner-load mode, raw outputs, and scenario digest survive aggregation
  without projection or rounding.

## Fault matrix

| Boundary / axis | Required outcome | RED target |
|---|---|---|
| registry/dev-server `unbounded-read` / failure | bounded timeout; non-zero exit; no success artifact | hung/failed lane fixture |
| page/Worker death (`provenance-lie`) | reject the run; never claim a topology or timing without its terminal proof | incomplete lane aggregation |
| guest/result `corrupt-input` / `lossy-aggregate` | reject wrong digest, dependency identity, duplicate/missing markers, wrong module count, or partial N-run set | artifact verifier table |
| strict port `concurrent-same-key` | refuse an occupied port before launch; never measure a foreign server | occupied-port runner test |
| CLI `corrupt-input` | reject missing/malformed `--runs` or `--out` before browser/server launch | argument table |
| artifact storage `quota-perm-fail` / `torn-state` | write a sibling temp then atomic rename; failure leaves no partial success artifact and exits non-zero | injected write/rename failures |

## Out of scope

- A CI performance threshold or a numeric product-vs-in-realm multiplier.
- Vite wall time including the product spawn floor; use Vite's self-report.
- Large-file reads/writes, install timing, non-COI product policy, loaded-owner
  stress, or benchmarks other than the two goal anchors.

## Decisions

- 2026-08-26 — dedicated `tools/perf/child-fs.mjs` runner, not the 757-line
  cold-start harness and not an always-on e2e spec: same strict-port pattern,
  separate artifact/schema and explicit invocation.
- 2026-08-26 — one canonical scenario module feeds both lanes; exact digest and
  dependency identity are acceptance, so the comparison cannot drift silently.
- 2026-08-26 — default one complete sample keeps the lane operable; `--runs N`
  provides repeats and completeness is exact. No median is accepted from a
  partial set.
- 2026-08-26 — Contract+RED attempt 1 @ 5e025cbc8 blocked: expected RED carriers
  absent; spike reference unpinned/non-closing; robust CLI/publication rows
  missing. Re-cut in place, no implementation started.
- 2026-08-26 — Contract+RED attempt 2 @ fb02b2c2f blocked: helper REDs cannot
  prove either physical lane or orchestration; second consecutive blocker
  triggers split/re-refine. Pre-demotion Acceptance/Parity preserved verbatim.
