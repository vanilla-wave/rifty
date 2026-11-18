---
area: distribution
status: draft
title: Isolate host timer expiries have no backpressure into the isolate — an interval storm ends as `memory`
created: 2026-11-18
why: The child queues one `fire.applyIgnored` per host timer tick with no bound, so many short intervals pile up calls faster than the isolate runs them and the child dies of memory where Node just runs them.
sources: [docs/public/compat/isolate-host.md]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-guest/src/bridge.ts]
---

## Context

@ 4cacd8cfc, Node v24.16.0, `runCode(code, { timeoutMs: 30000 })` vs `node -e`:
`let n = 0; const ts = []; for (let i = 0; i < 20000; i++) ts.push(setInterval(() => { n++ }, 1)); setTimeout(() => { ts.forEach(clearInterval); console.log('done', n > 0) }, 1000)`
→ Node exit 0, stdout `done true` (1.0 s); host `{exitCode: null,
termination: 'memory'}` after ~1.0 s, stdout empty. Each host interval tick
calls `fire.applyIgnored` into the isolate (bridge `timerStart` →
`setInterval`), and nothing limits how many are in flight while the isolate is
busy. Found by cross-review round 3 of PR #405. Bounded by I4 (a distinct
termination, the consumer unharmed); a fidelity gap, compat ⚠️.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
