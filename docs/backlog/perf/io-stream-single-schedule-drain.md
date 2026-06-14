---
area: perf
subsystem: runtime-js
status: active
title: ADR-0083 — single-schedule drain (drainScheduled) + bounded sync-drain loop for io streams
created: 2026-06-08
why: N writes queue N queueMicrotasks (one chunk/turn); behavioral rewrite, ordering/backpressure parity-critical; write-before-code
user_story: As a dev streaming many `Writable.write`/`Readable.push` chunks, I want them to drain in one scheduled turn, but today each chunk costs its own `queueMicrotask` so N writes burn N turns of latency
sources: [perf-audit #25, adr-plan A/ADR-0083, ADR-0034 (cite, not supersede)]
---
## Context
writable.ts:152,208 / readable.ts:357,382: per-chunk `queueMicrotask` in Writable.write / Readable.push. Governs internal scheduling of Writable/Readable (private flag; no public shape change). rule4 (behavioral rewrite + ordering/backpressure parity).
## Options / Next
Fix A (low-risk first): `drainScheduled` flag collapses N schedules → 1. Fix B (separate commit): loop in drainBuffer while `_write` fires synchronously, break on first async. Must cite ADR-0034 as event-semantics contract it must NOT break. Full stream suite must stay green; bound sync loop by "first async _write".
## Reversibility
IRREVERSIBLE — rule4 behavioral rewrite. Cites ADR-0034 (stream event semantics), does not supersede. No decision subagent.
