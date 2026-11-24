---
area: runtime-js
status: draft
title: "`Buffer.alloc(-1)` and `events.once(1)` throw V8/internal errors instead of Node's `ERR_OUT_OF_RANGE`/`ERR_INVALID_ARG_TYPE`"
created: 2026-11-24
why: code that checks `e.code` for invalid input (or prints it to the user) sees an engine message and no code
sources: [docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md]
code: [packages/io/src/buffer.ts, packages/io/src/event-emitter.ts]
---

## Context

Side observation of PR #436 (isolate `navigator` with Node's shape) (probing
rifty's error shapes), `runCode` vs `node -e`, Node v24.16.0, 2026-11-24:

| call | Node | isolate guest |
|---|---|---|
| `Buffer.alloc(-1)` | `RangeError [ERR_OUT_OF_RANGE]: The value of "size" is out of range. It must be >= 0 && <= 9007199254740991. Received -1`, `code` | `RangeError: Invalid typed array length: -1`, no `code` |
| `require('events').once(1)` | rejected promise: `TypeError [ERR_INVALID_ARG_TYPE]: The "emitter" argument must be an instance of EventEmitter. Received type number (1)` | rejected promise: `TypeError: emitter.once is not a function`, no `code` |

Browser hosts share the code (not measured). Label gap aside
(`runtime-js/node-error-code-label`), message and `code` differ (both
`once` forms reject). Compat buffer.md `Buffer.alloc` ⚠️ (2026-11-24); `events.once` has no row.

## Next

Owner runtime-js. Trigger: a package handling these errors by `code`, or a
sweep of argument validation against Node's `validators.js`.
