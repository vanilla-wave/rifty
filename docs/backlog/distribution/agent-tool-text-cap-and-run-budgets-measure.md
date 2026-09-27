---
area: distribution
status: draft
title: Measure whether the 16 KiB tool-text cap costs the sandbox agent solved tasks before changing it
created: 2026-09-27
why: the no-COI + agent fidelity audit found rifty's tool-text cap three times tighter than Pi's 50 KB reads and real `vite build` error output untested against it; ADR-0424 D7 records the cap, so a change needs measurement, not a hunch
sources: [ADR-0424, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/text.ts, tools/agent-bench/src/config.ts]
---

## Question

Fidelity audit row 15 (2026-09-27): `TOOL_RESULT_CAP_BYTES = 16 KiB` head/tail
on every tool result (`text.ts:1`); Pi's native tools read 50 KB / 2000 lines.
Long Vite/TypeScript error traces are exactly what a head/tail cut removes.
Does the cap change task outcomes on a benchmark corpus? A measured loss is
the evidence a superseding ADR on 0424 D7 needs. Owner: none yet — any
`tools/agent-bench` campaign may add the cap as an experiment variable
(`epics/agent-code-quality-evaluation`, PR #341, carries no obligation).
Neither the kit goal (`epics/no-coi-agent-host-kit`) nor this item changes it.

Run budgets (audit row 18) are settled elsewhere: `epics/agent-weak-models`
I9 (PR #359) sets the defaults to 100 calls / 600 s — user 2026-09-27
«3 - a»; the bench keeps its explicit 40 / 600 s config.
