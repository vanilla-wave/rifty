---
area: runtime-js
status: draft
title: "`process._exiting` reads `false` until exit and `true` inside `'exit'`, as in Node"
created: 2026-09-24
why: Node's undocumented flag is set by `exit()` before `'exit'` fires (libraries use it to skip work during shutdown); rifty keeps its exit state internal, so `process._exiting` is `undefined` throughout
sources: [docs/backlog/runtime-js/reference/process-lifecycle-events-exit-code-evidence.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/process-lifecycle-events-exit-code-evidence.md`
(vitest-run-in-browser item 7; unit Out of scope). Node mechanism
(evidence §N, `internal/process/per_thread` `exit()`): `if
(!process._exiting) { process._exiting = true; process.emit('exit', …) }`.

Probe 2026-09-24 (scratch `child-worker` parity case, forked child through
the kernel Worker route, `tools/node-parity-runner` `runInNode`/
`runInRifty` @ `8c8993649`): child prints `JSON.stringify(process._exiting)`
in the body and in an `'exit'` listener:

```
node v24.16.0: ["body false","in-exit true"]
rifty:         ["body undefined","in-exit undefined"]
```

Compat ❌ `docs/public/compat/process.md` "`process._exiting`".

## Next

Owner runtime-js (ADR-0445 exit path). Trigger: a claimed consumer
reading `_exiting`. Parity first: the probe, plus natural exit, fatal
error and `exit()` inside `'exit'`; assigning it (Node: plain writable
property).
