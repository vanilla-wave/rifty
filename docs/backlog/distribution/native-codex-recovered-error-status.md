---
area: distribution
status: draft
title: "Which CLI error events determine final Codex terminal admission?"
created: 2026-10-15
why: A provider reconnect error precedes completed exit0 and app-judge PASS but the strict adapter records FAIL
sources: [tools/agent-bench/reports/summaries/2026-10-15-eval-v18-corrected/README.md]
code: [tools/agent-bench/src/lanes/native-codex.ts]
---

## Question

Does the actual CLI protocol authority distinguish transient error display
from terminal turn.failed? Current adapter treats any error event as failed;
this strict baseline is recorded, not silently weakened or declared incorrect
without an external contract. CLI0.162.1, actual command/model in raw trace.

Selected CSV nativeCodex3: HTTP503 Reconnecting2/5 error, then one turn.completed,
exit0 and same-origin full appjudgePASS. Agentstatuserror/selectedFAIL remains;
protocol/usage/raw events separately retained. No startup retry, extra model
attempt or score regrade. Coding failure cannot be inferred from this outcome.

`v18-native-cli-error-observation.json` binds original traceSHA/terminal events,
full judge and strict error. Reproduce actual CLI event interpretation before
choosing a terminal contract; no proposed adapter patch or inferred Node parity.

Owner: distribution/agent-bench. Trigger: next terminal/choice/presentation
observation pickup or reproduce this public path. No proposed code/gate change;
source stays at accepted revision. Native expense1/3PASS and booking3/3PASS,
so handoff conditional0/3 does not authorize another workflow oracle revision.
Dedup: distribution titles/code/goal maps, traps and ADR declined concepts;
no matching boundary item. Native confirmation question is separate.
