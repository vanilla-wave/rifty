---
area: distribution
status: draft
title: Support `node -p`, `--input-type=module -e` and `-r` in no-COI project commands as the COI path does
created: 2026-09-27
why: no-COI `project.run('node -p …')` throws a named NotImplementedError while `node -e` works and the COI path delivers Node 24 eval identity (ROADMAP M11); agents and scripts reach for `node -p` constantly
sources: [ADR-0418, docs/ROADMAP.md, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/workbench/src/workers/no-coi-project-command.ts]
---

## Context

Finding (fidelity audit row 13). `no-coi-project-command.ts:203-215` rejects
`node -p`, `node --input-type=module -e` and `node -r <mod>` with named
`NotImplementedError`s (`workbench.node.print-program-context`, …); `node -e`
runs. ROADMAP M11 states the COI first-15-minute path includes real Node 24
`node -e/-p` eval identity. Loud today, so not a Fidelity violation; a
divergence between the two compositions. Oracle: real Node 24 for the same
flags. Outside the no-COI agent host kit.
