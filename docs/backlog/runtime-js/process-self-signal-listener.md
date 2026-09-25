---
area: runtime-js
status: draft
title: Self `process.kill(process.pid, 'SIGUSR2')` terminates the process even when a `SIGUSR2` listener is registered
created: 2026-09-23
why: Node delivers a self-sent `SIGUSR2` to a registered listener and keeps running; rifty sends it to the kernel, which kills the process tree
sources: [docs/backlog/runtime-js/reference/builtin-static-names-prototype-methods-evidence.md, docs/backlog/runtime-js/reference/builtin-static-names-prototype-methods-final-green.json]
code: [packages/runtime-js/src/builtins/process.ts, packages/kernel/src/process-manager.ts]
---

## Context

REV-12 discovery D2 of `runtime-js/builtin-static-names-prototype-methods`
(evidence §D2; Node v24.16.0). A forked child runs
`process.on('SIGUSR2', …); process.kill(process.pid, 'SIGUSR2')`:
Node `{"out":"sent true\ngot SIGUSR2\n","code":0,"signal":null}`, rifty
`{"out":"sent true\n","code":null,"signal":"SIGUSR2"}`. `kill`
(`process.ts:678`) always posts `control:self-signal`
(`#requestSelfSignal`), and the kernel answers with `killRecordTree`
(`process-manager.ts:888`); the listener check lives only on the
externally delivered path (`#receiveSignal`, `process.ts:819`). Compat:
`docs/public/compat/process.md` named-imports row notes the gap.

## Next

Owner runtime-js; trigger: a consumer that self-signals with a live
`SIGUSR2` handler (debug/profiler toggles), or the next process-signal
unit. Parity case (`child-worker`) first.
