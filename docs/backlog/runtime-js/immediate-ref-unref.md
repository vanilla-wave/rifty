---
area: runtime-js
status: draft
title: "`setImmediate()` returns an `Immediate` with Node's `ref`/`unref`/`hasRef`"
created: 2026-11-23
why: "`setImmediate(cb).unref()` throws `TypeError: i.unref is not a function`; Node returns the `Immediate` and lets an unref'd immediate not hold the loop"
sources: [docs/backlog/runtime-js/reference/guest-builtin-names-baseline.md]
code: [packages/runtime-js/src/builtins/timers.ts]
---

## Context

Found by the CLOSE review of PR #425 (REV-12); predates it (main returned
`{ id }`). Probe 2026-11-23, isolate `runCode` vs Node v24.16.0:
`const i = setImmediate(() => {}); console.log(typeof i.unref, typeof i.ref,
typeof i.hasRef); i.unref()` → Node `function function function`, then fine;
rifty `undefined undefined undefined`, `TypeError: i.unref is not a function`.
Same object, PR #425 cross-review: `Object.keys(setImmediate(() => {}))` → rifty
`['id', '_onImmediate']`, Node `['_idleNext', '_idlePrev', '_onImmediate',
'_argv', '_destroyed']`. An unref'd immediate must not keep the process alive (keepalive owner
`internal/event-loop-keepalive.ts`). No compat row yet.

Owner: runtime-js (timers). Trigger: a package calling `unref()` on an
immediate, or the next change to the immediate queue.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
