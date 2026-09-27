---
area: distribution
status: draft
title: Measure whether the 16 KiB tool-text cap and the 100-call / 180 s run budgets cost the sandbox agent solved tasks before changing them
created: 2026-09-27
why: the no-COI + agent fidelity audit found rifty's caps three times tighter than Pi's defaults (50 KB reads, no run budget) and real `vite build` error output untested against them; ADR-0424 D7 recorded the values, so a change needs measurement, not a hunch
sources: [ADR-0424, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/text.ts, packages/agent/src/session.ts, tools/agent-bench/src/config.ts]
---

## Question

Fidelity audit rows 15 and 18 (2026-09-27): `TOOL_RESULT_CAP_BYTES = 16 KiB`
head/tail on every tool result (`text.ts:1`); `maxToolCalls` 100 and
`runTimeoutMs` 180 s defaults (`session.ts:47-48`); Pi's native tools read
50 KB / 2000 lines and its loop has no call/time budget; the bench runs 40
calls / 600 s. Long Vite/TypeScript error traces are exactly what a head/tail
cut removes. Does the cap or the budget change task outcomes on the
benchmark corpus? Owner: `epics/agent-code-quality-evaluation` (PR #341) /
`tools/agent-bench` — add cap/budget as experiment variables; a measured
loss is the evidence a superseding ADR on 0424 D7 needs. The kit goal
(`epics/no-coi-agent-host-kit`) does not change these values.
