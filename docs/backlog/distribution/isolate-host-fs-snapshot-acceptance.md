---
area: distribution
status: draft
title: Acceptance carrier for the isolate guest FS snapshot goal
created: 2026-11-22
why: carrier-first — the goal's scenario as one executable test, RED before the codec exists
user_story: As the goal driver, I want the snapshot scenario executable end to end, but today nothing runs it
epic: isolate-host-fs-snapshot
blocked_by: []
sources: [docs/backlog/epics/isolate-host-fs-snapshot/goal.md, ADR-0567, ADR-0558]
code: [packages/isolate-guest/tests/, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Scenario steps 1–4 of the goal over the built guest bundle in real
isolated-vm 7.0.2 (README embedder wiring) and over rifty `MemoryFs` in the
Node realm. Committed RED, marked expected-failure until the codec lands.

## Challenge

challenge: pending — reuses the goal's premise check
