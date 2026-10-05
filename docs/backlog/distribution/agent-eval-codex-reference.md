---
area: distribution
status: ready
title: Run native Codex as an inspectable benchmark reference
created: 2026-09-15
why: The existing benchmark has native Pi but no requested Codex reference.
epic: agent-code-quality-evaluation
blocked_by: []
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
Use the local runner's series/interruption contract. This evaluated Codex
process must not inherit the operating Codex session's history or judge answers.

## Challenge

challenge: 2026-10-05 — clear; reuse accepted separate-reference premise.

## Reference contract

- Oracle: native Codex CLI0.159.3 `exec --json --ephemeral`; probes in `reference/agent-eval-codex-execution-probe.json` and `reference/agent-eval-codex-cancellation-probe.json`.
- Mechanism: real CLI owns agent loop/tools; adapter only process lifecycle/events and common native preparation/judging.

## Acceptance

1. Explicit Codex model/reasoning/sandbox settings resolve into plan and retained header; native-codex is separate from same-model Pi comparison. → I2+I4
2. A real fresh ephemeral Codex process attempts an existing task in an isolated native workspace, with actual events/usage/diff and the same own-environment judge. No operator history, config, project instructions or judge answers are seeded. → I2+I3
3. Completion requires successful `turn.completed`, no failed turn and process exit0; cancelled exit0 is unsuccessful. Timeout/tool-event budgets retain transcript and distinct exhaustion; malformed/incomplete JSONL is an explicit unsuccessful record with retained transcript. → I3

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| provenance-lie × process exit0 without completion | error/budget-exceeded, never success | recorded native cancellation probe; adapter observation tests | → I3 |
| corrupt-input × JSONL | error outcome with retained transcript | recorded normal/cancellation streams and actual existing-task/deadline control | → I3 |
| unbounded-read × agent process | deadline requests SIGINT cancellation, evidence retained | real native deadline trial | → I3 |
| sibling-drift × workspace/judge | native Pi/Codex share preparation and common judge | real existing-task Codex acceptance | → I2+I3 |

4. Native stdio capture preserves valid UTF-8 across chunk boundaries; direct logs preserve original bytes. Real Node subprocess RED in `proc-output.fault.test.ts`; sweep shared process helper/native Pi collector/log writer. → I4

## Out of scope

Native Codex is no same-model causal control. CLI does not offer Pi's pre-dispatch
admission hook; observed-event cancellation may overshoot, explicitly recorded.
No replacement agent loop, Codex resume or live-model CI default.

## Decisions

- 2026-10-05 — SIGTERM exits0 but leaves the Node tool alive; full-EOF SIGINT exits1 and terminates it. Use SIGINT for Codex, captured in `reference/agent-eval-codex-sigint-settlement-probe.json`; prefix-only earlier cancellation evidence annotated.
- 2026-10-05 — `all` selects four registered lanes; absent explicit Codex config is a retained setup failure, never an implicit paid default. Legacy scripted CI still executes only its configured Pi agents; selected Codex failures visible. Same-matrix tests strengthened before code.
- 2026-10-05 — observed native reader corruption: valid Ж split at1 byte becomes ��. Class corrupt-input/provenance-lie at native stdio; runToCompletion, native Pi collector, logged-server writer share this boundary. Real Node pipe RED before fix; preserve via Node streaming UTF-8 decoding/raw log bytes.
- 2026-10-05 — ADR-0505 owns adapter seam; real execution/cancellation probes precede code. CLI0.159.3 replaces help-only0.154.0 evidence.
- 2026-10-05 — native Codex selected model gpt-6.1-sol, reasoning low, automatic approvals with workspace-write; user config/rules/project docs disabled, authentication remains CLI-owned. Four-lane campaign records these differences.
