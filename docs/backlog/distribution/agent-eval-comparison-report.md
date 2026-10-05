---
area: distribution
status: draft
title: Report repeatable coding comparisons with uncertainty and failure evidence
created: 2026-09-15
why: Current per-task pass deltas lack uncertainty and the identity/accounting needed for the expanded comparison.
epic: agent-code-quality-evaluation
blocked_by: [distribution/agent-eval-codex-reference, distribution/agent-eval-project-corpus]
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
