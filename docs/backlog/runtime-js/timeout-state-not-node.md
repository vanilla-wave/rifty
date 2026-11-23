---
area: runtime-js
status: draft
title: "A `Timeout`'s state — id registry, `_onTimeout`, clear and destroy — is Node's"
created: 2026-11-23
why: "rifty's `Timeout` matches Node's `clearTimeout`/`listOnTimeout` conditions for a handle only; its numeric-id registry, non-function `_onTimeout`, string id and plain-object clears, `refresh()` and the `Immediate` fields differ"
sources: [docs/backlog/runtime-js/reference/pr-425-final-green.json, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/timers.ts]
---

## Context

PR #425 (three cross-review rounds, each a new `Timeout` state edge) ported
two conditions of Node v24.16.0: `lib/timers.js` clearTimeout (a handle is
unenrolled only `if (timer?._onTimeout)`, after writing `null`) and
`lib/internal/timers.js` listOnTimeout (no `_onTimeout` → destroyed unrun);
rows `interval-*-on-timeout`, `interval-cleared-after-null`,
`interval-setter-clears-itself`. Measured differences (live Node v24.16.0):

| member | Node | rifty | row / probe |
|---|---|---|---|
| numeric id registered | only in `Timeout.prototype[Symbol.toPrimitive]` (`+t`); `clearTimeout(<n>)` without it does nothing | in the constructor: `for (i < 200) clearTimeout(i)` clears it | `timer-not-cleared-by-unrelated-number` (Node `fired`, rifty '') |
| numeric id dropped | after the callback | before it (`fireTimeout`): `clearTimeout(+h)` inside the callback misses | `numeric-clear-inside-callback` (Node `true`, `at Timeout.<anonymous>`; rifty `false` on every host — isolate `at Timeout._onTimeout`, exit 1; COI `Uncaught Error: numeric-clear (<root>/main.js:4)`, no frame, exit 1; no-COI empty stderr, `exitCode: null`) |
| non-function `_onTimeout` (`t._onTimeout = 42`) | `TypeError: timer._onTimeout is not a function` | isolate `Function.prototype.apply was called on 42…`; no-COI empty stderr, `exitCode: null` | cross-review round 3 probe |
| string id (`clearTimeout(String(id))`) | `_onTimeout` null, exit 0 | host clear: callback skipped, `_onTimeout` kept, no natural exit | PR #425 Final probe |
| plain object with truthy `_onTimeout` | `_onTimeout` nulled | passed to the host clear unchanged | PR #425 Final probe |
| a getter returning a function, no setter | the null write throws at `clearTimeout (node:timers:…)` | throws `TypeError` too, at the caller's frame | cross-review round 3 |
| `refresh()` | re-arms | absent (`runtime-js/timeout-refresh`) | — |
| `Immediate` own keys, `ref`/`unref`/`hasRef` | `_idleNext`, `_idlePrev`, `_onImmediate`, `_argv`, `_destroyed`; present | `id`, `_onImmediate`; absent (`runtime-js/immediate-ref-unref`) | — |

Next: port the registry and the state transitions of `lib/timers.js` and
`lib/internal/timers.js` as one unit, not case by case (`REV-7`). The comment
above `handlesById` in `timers.ts` still says a numeric id resolves «the way
Node does» (from main; PR #425 round 4): the first two rows refute it — rewrite
it with the unit.

Owner: runtime-js (timers). Trigger: a package relying on timer ids or
`_onTimeout` (test fake-timer libraries, schedulers), or the next change to
`timers.ts`.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
