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
