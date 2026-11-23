---
area: runtime-js
status: draft
title: "Microtasks a CommonJS entry or `-e` queued before its synchronous fatal throw never run, as in Node"
created: 2026-11-18
why: Node exits inside TriggerUncaughtException before the microtask queue drains; rifty reaches the fatal terminal after promise hops, so such a microtask prints and its `exit()` sets the status on every host
sources: [docs/public/compat/process.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md]
code: [packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/loader.ts, packages/workbench/src/workers/no-coi-project-command.ts]
---

## Context

PR #406 outside finding 9 (r2/r3 cross-review probes). Node v24.16.0, probe
2026-11-18, entry `Promise.resolve().then(() => { …; console.log('micro') })`
then `throw new Error('boom')`:

- `.cjs` and `-e`: no `micro`; status 1 whatever the microtask does
  (`exitCode = 5` → 1, `process.exit(0)` → never runs).
- `.mjs`: `micro` prints and `process.exit(9)` there → 9 (ES module evaluation
  rejects; the microtask runs first in Node too).

Rifty (code read, `node-entry.ts` `runNodeEntry`): the program branch dispatches
after `await loader.import(...)`, so the microtask has run before the dispatch;
the eval branch dispatches synchronously, but the no-COI host's
`await runNodeEntry` catch runs after a hop. PR #406 restores
`exitCode` to the fatal `'exit'` listeners' value (a microtask's write no
longer changes the status, carrier `eval-fatal-microtask-exit-code`); its
output and an `exit()` still take effect (`.cjs` + `exit(4)` → 4, r3 reviewer
probe, scratch). Dedup (main + open PRs, 2026-11-18): `late-unhandled-rejection-drain`
owns a rejection vs an already-queued callback, not this. Fault: `observable-order`.
Compat ⚠️ `process.md` "Handler dispatch … no-COI".

## Question

Can the CommonJS loader or eval runner reach the dispatch and the terminal
before any guest microtask runs (a synchronous evaluation path), and what does
that path cost the loader?
