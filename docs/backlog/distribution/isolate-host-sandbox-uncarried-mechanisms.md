---
area: distribution
status: draft
title: Three isolate-host sandbox mechanisms without a discriminating carrier
created: 2026-11-23
why: Final+GREEN r12–r16 of PR #419 left three mechanisms that no test tells apart from a mutant of them.
sources: [docs/backlog/distribution/reference/isolate-host-sandbox-core-final-green.json, PR-419-external-review]
code: [packages/isolate-host/src/pool.ts, packages/isolate-host/src/child/main.ts]
---

## Context

- The runCode request line is written inside the guarded `try` of `Worker.place`
  (a throw ends the worker as lost, no phantom call): `stdin.write(string)` has no
  synchronous throw a test can inject (a mutant writing it outside the `try` survives).
- The worker clears `holdsState` once the restore is applied, so a later RSS crossing
  is the run's `memory`, not a `RESTORE` refusal: no carrier crosses the RSS ceiling
  in the window between restore and guest start.
- A worker spawned for a call whose state encode throws stays idle (warm, unref'd)
  until the pool's next settle: harmless, not ended at once.

Owner: distribution (isolate host). Trigger: the next change to `Worker.place`, the RSS ceiling or `holdsState`, which must then bring a carrier.

## Challenge

challenge: 2026-11-23 — none yet (factual capture at the live-sandbox goal's close, ADR-0568)
