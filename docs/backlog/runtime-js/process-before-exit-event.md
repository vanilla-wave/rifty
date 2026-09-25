---
area: runtime-js
status: draft
title: "`process` emits `'beforeExit'` when the event loop drains, as in Node"
created: 2026-09-24
why: Node emits `'beforeExit'` (with `process.exitCode || 0`) on natural drain and keeps running if a listener schedules work; rifty never emits it, so drain-time flushes and "keep alive until done" listeners never run
sources: [docs/backlog/runtime-js/reference/process-lifecycle-events-exit-code-evidence.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/process-lifecycle-events-exit-code-evidence.md`
(vitest-run-in-browser item 7; unit Out of scope, goal map §Out of scope
"note, not an obligation" — not on vitest's path: `grep -rn beforeExit`
over vitest 4.1.11 = 0, evidence). Node v24.16.0 evidence o07:
`a` / `BEFORE-EXIT 0` / `EXIT 0 undefined` / `EXIT2 0`, exit 0.

Probe 2026-09-24 (scratch `child-worker` parity case, forked child through
the kernel Worker route, `tools/node-parity-runner` `runInNode`/
`runInRifty` @ `8c8993649`): child
`process.on('beforeExit', c => out('beforeExit ' + c)); process.on('exit', c
=> out('exit ' + c)); out('body')`:

```
node v24.16.0: ["body","beforeExit 0","exit 0"] code 0
rifty:         ["body","exit 0"]                code 0
```

Compat ❌ `docs/public/compat/process.md` "`'beforeExit'` event".

## Next

Owner runtime-js (process lifecycle, ADR-0445 dispatch + ADR-0152 drain).
Trigger: a claimed program using `'beforeExit'` (flush-on-drain, work
scheduled from the listener). Parity first: o07, a listener that schedules
a timer (emitted again after it drains), none after explicit `exit()` or a
fatal error.
