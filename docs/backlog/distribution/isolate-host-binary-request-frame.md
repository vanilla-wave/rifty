---
area: distribution
status: draft
title: A byte frame consumer → worker for a sandbox run's state instead of base64 in the JSON line
created: 2026-11-23
why: The state travels as base64 inside the JSON-line request (ADR-0563 §3, ADR-0568 §6): a third more bytes queued on the consumer and one more pass each way.
sources: [ADR-0568, PR-419-external-review]
code: [packages/isolate-host/src/pool.ts, packages/isolate-host/src/child/main.ts]
---

## Context

Measured 2026-11-23 (M3 Pro, load ~20): after streaming the base64 in pieces and
encoding per attempt, the consumer's peak per run is ≈ 4 × S + 8 MiB (S = 56 MB:
212 MiB one run, 925 MiB four). The queued base64 is ≈ 1.33 × S of that; a byte
frame would cut it to S and drop the encode/decode passes. Not built: it is a
wire change no part of the sandbox contract needs.

## Challenge

challenge: 2026-11-23 — none yet (factual capture)
