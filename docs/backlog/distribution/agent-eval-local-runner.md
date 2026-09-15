---
area: distribution
status: draft
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
