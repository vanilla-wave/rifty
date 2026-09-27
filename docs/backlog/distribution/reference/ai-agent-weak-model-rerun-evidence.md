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
