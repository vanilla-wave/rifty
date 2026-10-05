---
area: distribution
status: ready
title: Run local eval series through deterministic repository scripts
created: 2026-09-15
why: Codex must invoke a reproducible execution protocol rather than invent the run sequence, and interruption must retain a partial report without resuming or overwriting a series.
epic: agent-code-quality-evaluation
sources: [ADR-0434, docs/backlog/distribution/reference/agent-code-quality-refine-evidence.md]
code: [tools/agent-bench/src/cli.ts, tools/agent-bench/src/config.ts, tools/agent-bench/src/runner.ts, tools/agent-bench/src/report.ts]
---

## Context

User chose local execution through Codex, driven by repository scripts, with
partial reports on interruption and a fresh series on the next run (I8/I9).
Current bench already has a CLI, fixed task/lane/trial loops and per-completed-
trial reports. It accepts existing output directories and has no explicit
interrupted-series contract or inspectable resolved experiment plan.

Extend that tool's existing owner. Document the operator path: Codex selects
explicit inputs, invokes scripts, follows progress and explains retained
results. Scripts validate inputs, resolve the matrix, prepare real isolated
workspaces, run agents and common judges, persist results and generate reports.
The same entry points also run directly without an interactive model operator.
Codex's reference lane remains isolated from the operating Codex session.

Record corpus/config/model/limits/versions and harness-controlled input/order
before execution. Unknown failures remain unknown; model text or the operator's
opinion cannot override checks. Identical configuration does not promise
identical model outputs or timing; fixed evidence must yield the same scores.
No benchmark tuning, hidden reruns of scored attempts or result-dependent
task selection.

Interruption preserves persisted completed records and exposes unfinished
work in a partial report. A new run uses fresh workspaces and separate output;
an occupied output target is rejected, not overwritten or resumed. Exact
commands/config representation are implementation choices at PICKUP.

Prove the smallest path on one existing task first, including interrupt →
partial report → new series and report regeneration without model requests.
Deterministic model-boundary controls prove plumbing only; I5 still requires
real agent trials. PICKUP traces physically reachable interruption, output
collision and persistence failures to I8/I9; before introducing coordination
or a new persistence mechanism, perform the existing fault-class inventory.

Order (2026-09-27, three-goal review): goals run whole and in sequence —
`epics/agent-weak-models` (PR #359) → `epics/no-coi-agent-host-kit` (PR
#357) → this goal — so the restructured runner/config/report carries the
bench `endpoint` as a model-catalog entry, the per-run metric columns and the
`context-exceeded` outcome, one recorded weak-endpoint baseline, and the kit's
no-COI lane composition (its reference host module), instead of being
rewritten under them.

## Challenge

challenge: 2026-10-05 — clear; reuse goal's checked premise, unchanged I8/I9.

## Acceptance

1. `agent-bench plan` resolves task/lane/trial order, source/dependency/judge/config identity without model calls; selected unsupported trials remain in the matrix. `series.fault.test.ts`, real existing-task series. → I8
2. `run` exclusively creates its output, persists the plan before setup, reports progress and retains completed attempts plus visible missing/unfinished trials after SIGINT/SIGTERM or setup failure. → I9
3. `report` regenerates the same summary from retained evidence without agent calls; subsequent runs use new output and workspaces. Real native scripted existing-task interruption/new-series acceptance. → I8+I9

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| concurrent-same-key × output creation | EEXIST before setup; prior evidence intact | series.fault.test.ts occupied directory | → I9 |
| torn-state × signal/setup/cleanup | persisted completed records remain; unfinished matrix visible | series-interruption.spec.ts real native process | → I9 |
| quota-perm-fail × persistence | loud throw; no retention claim | series.fault.test.ts invalid output path | → I9 |
| provenance-lie × unsupported selected trial | recorded setup failure, never silently omitted | series.fault.test.ts matrix; real no-COI node trial | → I8+I9 |

## Out of scope

Resume and occupied output throw; no crash-resume service, scheduler or scored retry.

## Decisions

ready-verdict: 2026-10-05 — Contract+RED @ f4761b3ca0f997c39841cdbfcc4b1f750ee3a02c

- 2026-10-05 — prerequisite PRs #359/#357 merged; existing runner/report remain state owners; inherited endpoint, metrics, budgets and packed reference host.
- 2026-10-05 — class sweep: runner only series writer; report writes JSON directly; proc owns cancellation; no existing series/lock/ledger to reuse. Exclusive mkdir + atomic file replacement, one serial loop; tier works does not promise crash-resume.
