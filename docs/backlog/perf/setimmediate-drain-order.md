---
area: perf
subsystem: runtime-js
status: draft
title: ADR-0092 — setImmediate/clearImmediate Map + head-cursor + check-phase tail-snapshot drain order
created: 2026-06-08
why: setImmediate/clearImmediate O(n) array ops; observable drain-order change on public ./builtins/timers (ADR-0018); parity cases must be written FIRST
user_story: As a dev scheduling many `setImmediate`/`clearImmediate` callbacks, I want O(1) clear and Node-matching nested drain order, but today array ops are O(n) and the head-cursor + check-phase tail-snapshot rewrite is deferred behind parity cases not yet written.
sources: [perf-audit #28, adr-plan A/ADR-0092, ADR-0018, ADR-0026 (downgraded)]
---
## Context
timers.ts:10-50. Auditor overturned mapper's rule5/OPEN_QUESTIONS call (mapper grounding "module-private / no cross-package API" is stale; adrRefAccurate=false). ADR-0018 ratifies ./builtins/timers as stable public API (package.json:31 + playground real-vite-bootstrap.ts:62 import installTimerGlobals); tail-snapshot changes the observable contract of a committed cross-package export. rule1. Governs drain-order contract (signatures unchanged; observable nested-drain ordering changes).
## Options / Next
`Map<id,item>` for O(1) clear + head-cursor drain; snapshot tail at tick entry so a nested setImmediate defers to next check phase (Node parity). Write nested-setImmediate + setImmediate-vs-setTimeout(0) parity cases FIRST (parity-first hard rule; none exist). Caveat: current array impl is already check-phase-correct via single-shift-per-postMessage; tail-snapshot = "preserve correct nesting under a batch-drain rewrite."
## Reversibility
IRREVERSIBLE — rule1 (behavioral-contract change on public cross-package export). Does NOT supersede ADR-0018 (commits the surface, records no drain order). No decision subagent.
