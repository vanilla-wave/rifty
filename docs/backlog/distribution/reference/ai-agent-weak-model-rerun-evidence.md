# I13 — preparation

Accepted I7–I11 source481b2ab3a, Final+GREEN25/25 coverage, gate25/25.
Only I13 remains. Frozen I12:40/42, original config and source artifacts intact.

Comparison RED: `tools/agent-bench/src/comparison.test.ts`,10/10 failures before
implementation (`/private/tmp/rifty-pr359-comparison-red.log`). Tests use copies
of the recorded42-run baseline, never overwrite it: exact counters/medians/deltas,
negative1-of3 remains regression despite another gain/noise label, incompatible
config/identity/groups/metrics refuse, real CLI must write comparison artifacts
and signal regression. Agent-bench typecheck passes.

Scope: same existing task/lane rows of3; unsupported no-COI Node pair unchanged.
No task/lane loss can be cancelled by a different row gain. Complete formal run
must have42 original outcomes, with clean source and no concurrent source/build
changes. No picked replacement agent runs. Per-row noise is reported, not waived.

Upcoming proof: comparison GREEN/CLI, unchanged frozen baseline/config/task
hashes, actual42-run Luna rerun, compressed full trace/before/after snapshots and
manual failure classification, same-config comparison, independent goal closure
covering unchanged I1–I12 proof and transitions. Any regression remains open.
Proxy10539 models endpoint confirms gpt-6-luna; no credentials/env inspected.

Contract+RED accepted at55c572818:0 blockers,3 advisory weak carriers.
Strengthened context/edit counters, unmatched index/task and distinct provenance;
13/13 RED before implementation,13/13 GREEN afterwards (actual CLI included).
Control13/13 passes; each metrics/identity/provenance omission mutant now fails
(`/private/tmp/rifty-pr359-rerun-strengthened-mutant-*.log`).

## Executed result

Clean61605476e1217b328c8989e895c4320c6b25624a:42/42 PASS vs40/42;
all14 task/lane rows nonnegative. Gains URL/no-COI and Node/native +1/3,
labelled within noise. Source/config/tasks/judges frozen throughout measurement.
Artifacts: `tools/agent-bench/reports/summaries/2026-09-28-gpt-6-luna-rerun`;
all42 full traces/before/after roundtrip,210 original hashes; no failed,
interrupted or replacement runs. No provider/budget/context outcomes.
Fullgate25/25 (test:run10597 pass,0 fail; no isolation),
`/private/tmp/rifty-pr359-comparison-pr-check.log`; comparison13/13 actual CLI.
CI61605476e all20 jobs green, including Chromium/no-COI/native parity.
I1–I12 accepted review/e2e/differential proofs stay unchanged; final whole-goal
review remains before CLOSE.
