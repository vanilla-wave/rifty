---
area: distribution
status: ready
title: Report repeatable coding comparisons with uncertainty and failure evidence
created: 2026-09-15
why: Current per-task pass deltas lack uncertainty and the identity/accounting needed for the expanded comparison.
epic: agent-code-quality-evaluation
sources: [ADR-0434, docs/backlog/distribution/reference/agent-code-quality-refine-evidence.md]
code: [tools/agent-bench/src/report.ts, tools/agent-bench/src/runner.ts, tools/agent-bench/src/config.ts]
---

## Context

Existing JSON/Markdown retains trials, per-task pass proportions, manual failure
classes and source/model metadata. Extend that owner for I3/I4's declared matrix,
expanded version identity, per-workload summaries and uncertainty. Keep native
Pi comparisons distinct from Codex reference results and retain original failed
or unevaluable trials; no causal attribution based only on lane identity.

PICKUP fixes and validates the estimator, repeat/order rules and comparison
eligibility before measurement. Execute I5's real reference campaign over the
finite accepted corpus and four environments; demonstrate regenerating reports
without new model calls. A negative or inconclusive result is a valid outcome.
Record the declared matrix size, expected runs, wall-clock and usage before a
campaign starts; the pilot corpus frozen under I7 can close I5.
Deterministic plumbing tests are necessary infrastructure evidence, not measured
agent quality. No automatic merge gate or live-model CI default.

I7 requires separate smoke/regression, bug, feature and app results, plus
task/family counts distinct from repeated-trial counts. Identify pilot versus
frozen evaluation corpus and report selected reference-solution failures;
an optional compatible-task view uses a rule fixed before results and never
replaces the full selected matrix or rescues own-environment failures.

Consume the local runner's persisted series records for I8/I9; retain partial
versus completed series identity and visible missing work. Report generation
is deterministic over the same evidence and never calls a model. An operator
may explain or separately annotate results, never rewrite measured scores.

I10/I11 diagnostics reuse these records but remain a separate view/campaign:
operation differences, recovered obstacles, attempted difficulty levels and
boundary-confirmation evidence. Do not mix adaptively selected failures into
the representative aggregate or call a shared model/budget limit a Rifty
ceiling. Closing this item's I5 pilot leaves the diagnostics obligation open.

Shared bench (2026-09-27, three-goal review): this owner absorbs
`epics/agent-weak-models` item 12's smallest `report --compare` (PR #359: two
summary directories of one config, per-task before/after with a ±1-pass on 3
runs marked as noise) instead of leaving a second comparison design in
`report.ts`; that before/after measures harness mechanisms, separate from
this goal's Rifty-vs-native comparison and its uncertainty.

## Challenge

challenge: 2026-10-05 — clear; original goal/refine premise reused. Same existing
report/series owner, no new platform/state writer. Finite protocol/method route
selected before comparative calls; Contract+RED reviewer checks changed promise.

## Measurement protocol

Fixed task/pipeline pass probability under declared settings; no programming-task
population or isolated environment effect. Per-cell Clopper–Pearson95%, conditional
iid repeated trials. Simultaneous finite-cell bands use alpha0.05/cell-count;
equal task weights produce group/corpus bands, Pi deltas subtract those bounds.
Missing cells have point unavailable/[0,1]; observed selected-success bounds are
descriptive, never mistaken for statistical inference. Small samples explicitly
limited; provider/cache correlations may violate iid. Native Codex no Pi delta.
Existing before/after ±1/3 noise label remains a descriptive legacy heuristic,
not an equivalence/statistical proof. ADR-0507, primary NIST binomial/union sources.

Corrected pilot-v2 six tasks (originalv1 oracle history retained); both ms calibration, other four evaluation families. Three
fresh repeats/four origins/task-lane-trial order:72 selected,48 expected agent
calls/24 known browser library setup failures retained. Pi Luna same entry/medium,
Codex gpt-6.1-sol/low separate;100 tools/600s nominal per agent, native Codex event
cancellation can overshoot. No task-specific tuning/result-selected filtering.
Optional secondary reference-compatible view fixed before calls: both apps
passed all4 current reference controls; primary full matrix remains unchanged.
Expected cost/authoring effort recorded in reference protocol before execution;
manual authoring duration uninstrumented/unknown, artifact and observed validation
cost explicit. Estimates not billing evidence or a hard wall guarantee.

## Acceptance

1. `report` derives deterministic statistics/Markdown from retained authoritative
   JSON; per-task and project-change/app plus bug/feature/app, calibration/eval/
   smoke groups distinguish task/family/trial counts. Missing/setup/provider/
   judge/budget/context remain selected and visible; controls/scripted plumbing
   never represent measured quality. JSON scores/source artifacts not rewritten.
   Synthetic arithmetic and existing real-report regeneration probes. → I3+I4+I7+I8+I9
2. Correct conditional interval calculation (NIST exact4/20 alpha.1 and analytic
   endpoint/symmetry probes); complete-cell estimate and simultaneous task-macro
   bands/Pi deltas carry method/assumptions/limitations. Incomplete cells unknown;
   too little data never equality; Codex reference separate with unknown telemetry.
   Numeric/arithmetic reference tests. → I4
3. Identity includes frozen corpus/card/source/lock/prompt/judge hashes, actual
   agent/model/settings/source/runtime versions, changed installed inputs and
   per-attempt source links; comparison rejects input/judge/config/purpose drift,
   unmatched or partial matrices. Deliberate before/after source changes stay
   visible; unsupported rows cannot disappear. Identity/fault tests. → I2+I3+I4+I8+I9
4. Real on-demand pilot72 declared repeated attempts through all4 origins/both
   workloads, frozen settings/selection before calls; retain failed/unevaluable
   attempts and complete/partial status. Source evidence, usage/time/per-task/
   workload results and supported cause or unknown. After services/models stop,
   regenerate identical scores/view with unchanged authoritative JSON/traces and
   no new calls. Negative/inconclusive result valid; no equality claim. → I3+I4+I5+I7+I8+I9

## Fault matrix

| axis × operation | honest outcome | target | trace |
|---|---|---|---|
| missing/duplicate/out-of-plan × aggregate | reject invalid identities; explicit missing selected rows | statistics/report CLI fixtures | → I3+I4+I9 |
| input/judge/config drift × compare | reject; preserve originals | same-name/different-hash comparison | → I4+I8 |
| unknown telemetry × totals | unavailable stays unknown, not fabricated zero | native Codex incomplete/unknown fixtures | → I2+I4 |
| interrupted/setup/provider/judge × campaign | retain failed/partial/missing matrix; fresh series next | actual runner proofs reused; live campaign artifacts | → I3+I5+I9 |

## Decisions

- 2026-10-05 — method fixed before measurement: conditional CP intervals/Bonferroni finite-cell bands, no threshold/equality; ADR-0507. No new dependency/state owner.
- 2026-10-05 — source/package/harness before-after different versions intentional; task/judge/selection/config drift incomparable. Native Codex never same-model Pi delta.

## Out of scope

No equality/causal merge gate, population task-quality claim, paid CI default,
new platform/coordinator, runtime-gap repairs, resuming/overwriting a series.
Mandatory expansion/campaign and I10/I11 diagnostics remain linked next slices;
this unit's pilot closes I5 only, never the goal.
