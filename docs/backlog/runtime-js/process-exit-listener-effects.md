---
area: runtime-js
status: draft
title: "An `'exit'` listener's throw reaches `'uncaughtException'`, and its `exitCode` sets a fatal throw's status, as in Node"
created: 2026-09-24
why: rifty treats a throw inside an `'exit'` listener as a new fatal error (stderr, status 1) where Node routes it to `'uncaughtException'` and keeps the status; after a no-listener throw rifty exits 1 even when an `'exit'` listener set `exitCode` (Node: that code)
sources: [docs/backlog/runtime-js/reference/process-lifecycle-events-exit-code-evidence.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

REV-12 discoveries of `runtime-js/reference/process-lifecycle-events-exit-code-evidence.md`
(vitest-run-in-browser item 7; unit Out of scope: "A throw from an `'exit'`
listener … not claimed" (Node o39) and "A no-listener throw whose `'exit'`
listener sets `exitCode` … the default Worker report still exits 1").

Probe 2026-09-24 (scratch `child-worker` parity case, forked child through
the kernel Worker route, `tools/node-parity-runner` `runInNode`/
`runInRifty` @ `8c8993649`):

```
child                                              node v24.16.0                          rifty
'exit' listener throws + 'uncaughtException' one   ["exit 0","caught inexit"] code 0      ["exit 0"] code 1, stderr names inexit
'exit' sets exitCode = 5; setTimeout throw (none)  ["exit 1"] code 5, stderr               ["exit 1"] code 1, stderr
```

Compat ⚠️ `docs/public/compat/process.md` "Throw from an `'exit'` listener"
and "Fatal throw with an `'exit'` listener that sets `exitCode`" (a
rejection already honours it).

## Next

Owner runtime-js (ADR-0445 dispatch and exit path). Trigger: a claimed
consumer throwing or setting `exitCode` in `'exit'`. Parity first: both
rows above, plus a throw in `'exit'` with no `'uncaughtException'`
listener, and the timer/nextTick/entry origins of the fatal throw.
