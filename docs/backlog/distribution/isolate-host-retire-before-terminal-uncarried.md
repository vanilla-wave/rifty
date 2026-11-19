---
area: distribution
status: draft
title: Isolate host — the retire-before-terminal frame order has no discriminating test
created: 2026-11-19
why: The worker sends `retire` before the last terminal frame so no call is placed on a worker above its watermark; a mutant that sends it after survives every test.
sources: [docs/adr/distribution/0563-run-runcode-in-a-pool-of-long-lived-worker-processes-each-hosting-many-isolates.md]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-host/src/pool.ts]
---

## Context

Finding (CLOSE of goal `isolate-host-worker-pool`, PR #412, 2026-11-19; cross-review round 4). `src/child/main.ts` `report()` sends
`retire` (call 0) before a call's terminal frame when the worker becomes idle above `RECYCLE_RSS_BYTES`, so the consumer marks
it retiring before the slot frees, however the bytes are split. A mutant sending `retire` after the terminal frame passes the whole
isolate-host suite: the consumer usually reads both frames in one chunk, and the 25 ms idle poll retires the worker shortly after.
What it would cost if broken: a call placed in that window lands on a worker already above its watermark (delay, or a rerun). Open:
a carrier that splits the two frames across reads (a large output flush before the terminal frame, measured), or a hostile-worker
test of the consumer's side only.

## Challenge

challenge: 2026-11-19 — finding capture; no premise critic (README §Challenge)
