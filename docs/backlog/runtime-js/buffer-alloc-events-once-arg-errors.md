---
area: runtime-js
status: draft
title: "`Buffer.alloc(-1)` and `events.once(1)` throw V8/internal errors instead of Node's `ERR_OUT_OF_RANGE`/`ERR_INVALID_ARG_TYPE`"
created: 2026-11-24
why: code that checks `e.code` for invalid input (or prints it to the user) sees an engine message and no code
sources: [docs/backlog/distribution/isolate-host-navigator-node-shape.md]
code: [packages/io/src/buffer.ts]
---

## Context

Side observation of `distribution/isolate-host-navigator-node-shape` (probing
rifty's error shapes), `runCode` vs `node -e`, Node v24.16.0, 2026-11-24:

| call | Node | isolate guest |
|---|---|---|
| `Buffer.alloc(-1)` | `RangeError [ERR_OUT_OF_RANGE]: The value of "size" is out of range. It must be >= 0 && <= 9007199254740991. Received -1`, `code` | `RangeError: Invalid typed array length: -1`, no `code` |
| `require('events').once(1)` | rejected promise: `TypeError [ERR_INVALID_ARG_TYPE]: The "emitter" argument must be an instance of EventEmitter. Received type number (1)` | synchronous `TypeError: emitter.once is not a function` |

Browser hosts share the code (not measured). Label gap aside
(`runtime-js/node-error-code-label`), message, `code` and (for `once`) sync vs
rejection differ. No compat row names them (buffer.md `Buffer.alloc` ✅).

## Next

Owner runtime-js. Trigger: a package handling these errors by `code`, or a
sweep of argument validation against Node's `validators.js`.
