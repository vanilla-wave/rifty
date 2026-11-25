---
area: distribution
status: draft
title: A failed write of a run's state to the worker's stdin is swallowed and surfaces as a lost worker
created: 2026-11-25
why: `stdin.on('error', () => {})` drops a real write error (`ENOBUFS` when four ~146 MB states land on a fresh worker at once): the worker sees end of input, ends, and its calls rerun — a silent error turned into a retry.
sources: [ADR-0563, ADR-0568, PR-460-external-review]
code: [packages/isolate-host/src/pool.ts]
---

## Context

Found by the external review of PR #460 (macOS, four-library template, 8 calls at once): `write
ENOBUFS` on the worker's stdin while `Worker.place` writes four states of ~146 MB in pieces; the
error listener added for a worker that died meanwhile (`pool.ts`, «surfaces through 'exit', not an
EPIPE») swallows it too, the worker reads end of stdin and kills itself, its calls rerun once
(`rerun`). Nothing names the write failure: not the consumer, not the run's result.

Route: a fix item — a failing reproduction (a stdin that refuses a write) first; then the error
reaches the calls it hit (or backpressure keeps the write from failing), never only an exit.

Owner: distribution (isolate host). Trigger: picked up with `distribution/isolate-host-pool-rerun-at-template-scale`, or any write error seen in the wild.

## Challenge

challenge: 2026-11-25 — none yet (capture)
