---
area: distribution
status: draft
title: Run native Codex as an inspectable benchmark reference
created: 2026-09-15
why: The existing benchmark has native Pi but no requested Codex reference.
epic: agent-code-quality-evaluation
sources: [ADR-0434, docs/backlog/distribution/reference/agent-code-quality-refine-evidence.md]
code: [tools/agent-bench/src/lanes/types.ts, tools/agent-bench/src/runner.ts, tools/agent-bench/src/config.ts]
---

## Context

Only rifty/rifty-no-coi/local-reference exist. Local Codex CLI 0.154.0 help
advertises noninteractive JSONL, ephemeral sessions and explicit project/model
options; actual execution semantics remain unproven. User requests native
Codex as a separate reference, not a replacement for same-model native Pi.

Deliver a real Codex run on an existing task through the existing benchmark,
with retained output/artifacts, actual configuration, own-environment judging
and honest budget/failure handling (I2/I3). Begin with one task before the
new corpus. PICKUP probes public execution/completion/cancellation and records
any new adapter decision under ADR-0434's seam; never fabricate a native loop.
