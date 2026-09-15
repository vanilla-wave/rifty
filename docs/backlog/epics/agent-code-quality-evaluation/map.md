## Items

1. `distribution/agent-eval-codex-reference` — native Codex reference over one existing task first; reuse existing runner/judges/artifacts and establish the new adapter's real execution proof.
2. `distribution/agent-eval-project-corpus` — versioned real-project and different-starter tasks with functional/regression controls; reusable across existing lanes and Codex. Independent of the adapter's implementation.
3. `distribution/agent-eval-comparison-report` — expanded experiment identity, uncertainty and honest matrix accounting; then a real reference campaign and regeneration proof. Depends on 1 and 2.

## Open questions

- Codex's actual event/usage/completion, cancellation and context-isolation behavior — owner: agent — pinned public-CLI probe at adapter PICKUP; help/version is not execution evidence.
- Exact finite projects, starter versions, task snapshots and judge controls — owner: agent — corpus PICKUP selects representatives of both accepted groups and verifies original/fixed controls; no success-selected corpus pruning.
- Uncertainty estimator, number/order of trials and comparable-run rules — owner: agent — report PICKUP records the estimand and validates the calculation before the reference campaign; no automatic quality threshold.

These are implementation details within settled scope, not alternatives about
whose workflows or quality count. Draft children are compiled only at PICKUP.
The existing runner/report owns shared experiment state; no new scheduler,
storage service or parallel-run coordinator is presumed.

## Out of scope

- Empty-directory generation: user 2.2 chose installed minimal starters.
- Subjective architecture/readability/aesthetic scoring and automatic merge gate: user 1.3/1.4.
- Primary common-native grading or a controlled identical-agent experiment: user 1.1/2.1.
- New product UI, subagent orchestration, hosted eval platform and general runtime compatibility expansion: agent scope cut; measurement failures stay explicit, required harness defects are repaired in this goal.
- Erasing the old diagnostic's exclusions/history or claiming unsupported software works: never. New selected trials retain unsuccessful/unevaluable records and reasons.
