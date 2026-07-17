---
area: playground
status: draft
title: Archive durability must gate on the full persistence ledger
created: 2026-07-17
why: Archive settlement treats an empty sampled failure list as clean even when PersistFailureReport.total says unhealed OPFS failures remain.
user_story: As a playground user importing or exporting a project archive, I want success to mean the archive transaction reached durable storage, but a truncated OPFS failure sample can currently produce a false success.
sources: [docs/process/fault-classes.md, ADR-0278]
code: [apps/playground/src/workers/playground-archive-integration.ts]
---

## Context

`requireDurable()` checks `report.failures.length === 0`. That array is only a
bounded diagnostic sample; `report.total` owns whether the full persistence
ledger is clean. A report such as `{ total: 1, failures: [] }` therefore lets an
archive operation settle successfully despite an unhealed OPFS failure.

This was discovered while fixing the separate Cmd/Ctrl+S durability barrier.
Keep it outside that change: add a `quota-perm-fail` RED at the archive boundary,
gate success on `report.total === 0`, and retain optional sampled details only in
the loud error message.
