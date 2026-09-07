---
area: toolchain-build
status: ready
epic: no-coi-client-bundle
title: CI-only client bundle budget gate with headroom over the cleaned SDK artifacts
created: 2026-09-06
why: nothing measures what a consumer downloads — TypeScript at 77% of the no-COI worker and io at 4.7× the service worker shipped unnoticed; check:file-size counts source lines only and the packed-consumer fixture builds unminified and outside CI.
user_story: As the maintainer, I want CI to shout when a client artifact grows by a large step, but today no gate exists and I do not want the local pr:check to nag about small growth.
sources: [docs/backlog/distribution/reference/no-coi-client-bundle-evidence.md, AGENTS.md §Architecture (check:file-size ratchet), docs/process/rules/pr.md PR-6, docs/backlog/distribution/no-coi-vm-engine-default-rewrite.md]
code: [tools/checks/file-size.mjs, tools/checks/pr-check.mjs, tests/integration/fixtures/no-coi-packed-toolchain-consumer/build.mjs, tests/integration/workbench-packed-consumer.mjs]
---

## Context

Current sizes (evidence doc, dist, min / gz): sdk main 101 / 29 KB, sw 62 /
18 KB, no-COI toolchain worker 4471 / 1297 KB, generic runtime worker 4202 /
1213 KB. Expected after the two blocking items: main ≈ 55 / 17, sw ≈ 14 / 5,
no-COI worker ≈ 1000 / 300, generic worker ≈ 700 / 205 KB.
`pr:check` runs locally per PR-6; `check:file-size` is a shrink-only ratchet
on source lines. The packed-consumer fixture is the only consumer-download
authority (real `pnpm pack` tarballs, esbuild `splitting: true`) but builds
without `minify` and does not run in CI.

Both blocking items land `import()` boundaries; a bundle without `splitting`
inlines them, so a whole-bundle measure would read ≈ 4.4 MB with a
`typescript` input on a correct implementation. The artifact is therefore the
eager boot chunk under `splitting: true`.

## Challenge

challenge: 2026-09-06 — 6 problems
- budget calibration vs its own evidence: 1.5× + "round up" is not checked against the two leaks that motivate the item — main ≈55/17 → 82.5/25.5 → rounded 90–100/30 KB, while the evidenced io leak measured 101/29 KB: min fires by 1 KB, gz does not fire at all; the doc must show both historical leaks trip both budgets or the headroom rule is unproven.
- ceiling ≠ step detection: user_story asks to shout on "a large step", but an absolute pin also trips on the Nth small growth that crosses it — the innocent crossing PR is blamed and the only fix is a pin bump; state this explicitly (what a bump requires, who re-measures) or the gate degrades to a periodic reminder.
- measurement method breaks after the blockers: both blocking items land `import()` boundaries, and esbuild without `splitting` inlines dynamic imports (evidence script has none) — a bundle+minify measure of the cleaned worker would still read ≈4.4 MB with a `typescript` input, failing a correct implementation; define the artifact as the eager boot chunk under `splitting: true` and scope the no-`typescript` assertion to that chunk's metafile inputs.
- proof ownership double-counted: the lane "asserts no typescript input (the proof lazy-typescript-tsconfig-discovery needs)", yet that item is `blocked_by`-ordered first and already owns a metafile-assertion proof (DoD: acceptance proof in the same PR) — either this is a duplicate assertion or the blocker ships without its proof; pick one in the doc.
- "packed dist" authority unnamed: the only existing consumer-download authority is the packed fixture (`tests/integration/fixtures/no-coi-packed-toolchain-consumer`, real `pnpm pack` tarballs, esbuild `splitting`, not in CI) which the doc dismisses only as "unminified"; a `build:libs` + `publishConfig` resolver is faster but weaker (no `files`/pack-surface truth) — record which one and why (job placement, sw coverage), not the minify flag.
- boot-path scope silent on wasm: evidence lists QuickJS `emscripten-module.wasm` 503 KB / 232 KB gz "fetched at every worker boot/restart" — ≈44% of the post-cleanup worker gz download — neither budgeted nor in Out of scope; a gate whose why is "what a consumer downloads" should say so.

## Out of scope

- Playground bundles — own items (`playground/lazy-monaco-bundle-split`,
  `playground/worker-chunk-modulepreload`).
- Install-time payload (`esbuild.wasm` 13.9 MB via shadow substitution, Vite
  tarballs) — honest Vite bytes, not a bundle.
- QuickJS `.wasm` bytes — a request-count assertion owned by
  `distribution/no-coi-vm-engine-default-rewrite`, not a size budget here.
- Any budget on unminified fixture output.

## Decisions

- 2026-09-07 — pickup: tooling proof over accepted I1–I4 behavior (RDY-8); relevant discrimination checks + independent Final+GREEN, no new runtime promise.
- 2026-09-07 — reuse packed surface runner and compiler provenance; budget its post-readiness-accounted report, verify every observed boot JS request is included. Run only in CI's no-COI job.
- 2026-09-07 — absolute min/gzip ceilings = cleaned bytes ×1.5 rounded up to 1000 B; all four recorded leaks cross both ceilings. A bump carries new measurement and cause in this same gate file/PR; aggregate small growth can eventually cross a ceiling.

- 2026-09-06 — user (rifty-refine): absolute budgets with headroom, set after
  the cleanup items land; the gate fires only on a large leak, not on small
  growth.
- 2026-09-06 — user: CI lane only — never part of `pr:check`.
- 2026-09-06 — agent carrier: artifacts = sdk main (`@riftydev/sdk` →
  `createSandbox`), `@riftydev/service-worker/sw`, `@riftydev/runtime-js/worker`,
  `@riftydev/workbench/no-coi-toolchain-worker`; each measured as the eager
  boot chunk of an esbuild `splitting: true` build of the packed fixture
  (real `pnpm pack` tarballs, `minify` added), min and gz both budgeted.
- 2026-09-06 — agent carrier (after challenge): budget rule = cleaned size
  × 1.5 rounded up as the floor, then raised or lowered so that each recorded
  leak (TypeScript in either worker; io in sw and main) trips at least one of
  min/gz — the calibration table lands in the gate file with the measurement.
- 2026-09-06 — agent carrier (after challenge): a pin crossing on an innocent
  PR is answered by a bump in the same PR carrying the re-measured metafile
  numbers; the gate file records every bump with its cause.
- 2026-09-06 — proof ownership (after challenge): the lazy-TS item owns its
  landing proof (one-shot metafile assertion in its PR); this lane keeps the
  standing regression assertion — no `typescript` input in any worker's eager
  chunk — as a guard, not a substitute.
- rejected route: shrink-only ratchet (agent recommendation) — user: small
  growth must not interrupt work.
- Reversibility: REVERSIBLE — CI tooling.

## User scenario

CI packs the real SDK dependency closure, builds four minified splitting
artifacts, cold-boots both Workers in Chromium, and accounts for every JS
request before readiness. It applies absolute min and per-chunk gzip ceilings
with at least 50% headroom over the cleaned measurements. Historical TS/io
leaks fail; missing artifacts, missing compiler provenance or unaccounted boot
JS cannot turn into a green budget. Local pr:check keeps its existing lanes.

## Acceptance

- CI budgets actual packed main, sw, generic and toolchain complete eager JS graphs, including readiness-joined dynamic imports; min and gzip each have absolute ceilings with headroom. → I5
- Recorded TypeScript worker leaks and io main/sw leaks exceed at least one calibrated ceiling per artifact; clean graphs pass. → I5
- The standing worker guard rejects compiler input in eager code, using published source-map provenance across shared chunks. → I5
- Budget pin changes record measured cause; no shrink-only ratchet and no client size lane in local pr:check. → scenario

## Fault matrix

| Boundary / axis | Operation | Outcome |
|---|---|---|
| Measurement / lossy-aggregate | readiness-triggered JS missing from eager accounting | Gate rejects the missing observed output. → scenario |
| Measurement / provenance-lie | missing artifact or compiler provenance | Gate fails explicitly; absence cannot count as zero. → scenario |
| Budget / sibling-drift | historical worker TS and page/SW io leaks | Every named artifact exceeds its calibrated ceiling; no twin omitted. → I5 |

## Reference contract

Real packed baseline d52ef8128 (Node24.16/esbuild0.28/Chromium148) is recorded in
`docs/backlog/runtime-js/reference/lazy-compiler-packed-results.json`; real I4 packed
measurements calibrate the ceilings. `measure-bundles.mjs` plus Chromium's boot
request ledger is the graph authority. There is no latency target, total-app
budget, QuickJS WASM budget or install-time payload budget.
