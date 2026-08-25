---
area: perf
subsystem: toolchain-build
status: ready
title: Committed product-vs-in-realm perf lane for child fs anchors (vite build + express cold start)
created: 2026-08-26
epic: child-fs-rpc-hot-path
why: all current numbers live on a throwaway spike branch; the epic's I3 needs a durable rig so every slice proves its effect on the same anchors
user_story: As the epic's acceptance instrument, I want one committed lane that runs the 2180-module vite build and an express cold require-walk in BOTH worlds (product COI child over sync-RPC; single in-realm worker) and reports self-timed numbers, but today the harness is `prototype/` on the spike branch only.
sources: [spike branch t3code/prototype-no-coi-agent-cycle prototype/no-coi-agent-loop/README.md + FINDINGS.md §2b]
code: [tools/perf/child-fs.mjs, tools/perf/child-fs/, tests/browser-unit/fixtures/child-fs-in-realm-worker.ts]
---

## User scenario

From a clean Chromium profile, run one command against one pinned guest tree.
The first lane opens the real COI playground and executes both anchors in a
kernel-spawned child over owner sync-RPC. The second lane executes the identical
guest bytes in one in-realm Worker. Compare Vite's own `built in Xs` report for
the 2180-module fixture and Express cold `require('express')` start-to-listening.

## Reference contract

- Repro: `git show t3code/prototype-no-coi-agent-cycle:prototype/no-coi-agent-loop/FINDINGS.md`
  §2b on Chromium/Playwright; recorded output is product Vite 1.63 s vs in-realm
  1.13 s and 2180 modules in both lanes. The artifact pins the exact commit,
  browser version, dependency identities, scenario digest, and per-run outputs.
- Carrier evidence: `tools/perf/bench.mjs` already owns an isolated strict-port
  Playwright runner and refuses false/incomplete measurements; Playwright 1.60.0,
  Node v24.16.0, pnpm 11.5.2 on 2026-08-26.

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
