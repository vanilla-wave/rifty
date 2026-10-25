---
area: playground
status: draft
title: Firefox 150 COI playground stays at Booting before the project index
created: 2026-09-28
why: the COI app never reaches its launcher on Firefox CI although the lower-level live COI build oracle passes
sources: [ADR-0469, docs/backlog/playground/reference/browser-floor-cross-engine-evidence.md]
code: [tests/e2e/ai-mode.spec.ts, tests/e2e/helpers/playground.ts, apps/playground/src/App.tsx]
---

## Context

Finding. Manual run 36356372850, Firefox 150.0.2 / Ubuntu, SHA850eeee2640:
all 36 attempts of the first 12 `ai-mode` tests remain at `Booting rifty…`;
`.rf-app[data-project-index="ready"]` never appears. maxFailures leaves
185 tests unrun (four more declared skips). A retained retry trace records
436 HTTP200 responses and the Vite WebSocket101; no page error, only Vite's
connect messages. This is a reproducible run-level boot stall, not evidence
that Firefox lacks COI. The no-COI suite's separate live COI build oracle passes.

Class: engine-behavior, exact boot boundary/cause unisolated. Owner: playground
boot. Trigger: Firefox COI fidelity work; reproduce the real app entry and
isolate owner boot from project-index loading before proposing a repair.
The prior weekly launcher reds are historical evidence of the same visible
symptom; their cause was not established. Dedup: no active item owns this
Firefox150 boot stall; pre-145 waitAsync widening is a different question.
Outside browser-support-floor by its explicit record-only decision.
