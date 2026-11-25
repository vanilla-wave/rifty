---
area: runtime-js
status: draft
title: "`Buffer.alloc(-1)` and `events.once(1)` throw V8/internal errors instead of Node's `ERR_OUT_OF_RANGE`/`ERR_INVALID_ARG_TYPE`"
created: 2026-11-24
why: code that checks `e.code` for invalid input (or prints it to the user) sees an engine message and no code
sources: [docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md]
code: [packages/io/src/buffer.ts, packages/io/src/buffer-prototype.ts, packages/io/src/event-emitter.ts]
---

## Context

Side observation of PR #436 (isolate `navigator` with Node's shape) (probing
rifty's error shapes), `runCode` vs `node -e`, Node v24.16.0, 2026-11-24:

| call | Node | isolate guest |
|---|---|---|
| `Buffer.alloc(-1)` | `RangeError [ERR_OUT_OF_RANGE]: The value of "size" is out of range. It must be >= 0 && <= 9007199254740991. Received -1`, `code` | `RangeError: Invalid typed array length: -1`, no `code` |
| `require('events').once(1)` | rejected promise: `TypeError [ERR_INVALID_ARG_TYPE]: The "emitter" argument must be an instance of EventEmitter. Received type number (1)` | rejected promise: `TypeError: emitter.once is not a function`, no `code` |
| `require('querystring').unescapeBuffer(1)` (also `true`, `{}`, `Symbol()`; `unescape(Symbol())`) | `TypeError [ERR_INVALID_ARG_TYPE]` (Node's `Buffer.allocUnsafe(s.length)` with `undefined`) | `Buffer(0) []` / `''`: rifty's `Buffer.allocUnsafe(undefined)` is an empty buffer (PR #444 review round 1; runtime-js lane, 2026-11-24) |

Buffer `write`/`fill`/`toString`/`byteLength`, in-process `@riftydev/io` vs Node v24.16.0
(unit `runtime-js/buffer-encoding-names`, 2026-11-25):

| call | Node | rifty |
|---|---|---|
| `Buffer.alloc(6).write('a', null)` / `fill('a', null)` | `ERR_INVALID_ARG_TYPE` (`"offset"`) | `write` writes at 0; `fill` fills the whole buffer |
| `Buffer.alloc(4).write('a', 9)` | `RangeError` `ERR_OUT_OF_RANGE` | same message, no `code` |
| `Buffer.alloc(4).fill(1, 3, 2)` | returns the buffer | `RangeError: Out of range index` |
| `Buffer.from('abcdef').toString('utf8', -2)` | `'abcdef'` (start clamps to 0) | `'ef'` |
| `Buffer.byteLength(new ArrayBuffer(5))` | `5` | `20` |
| `Buffer.byteLength(1)` | `ERR_INVALID_ARG_TYPE` | `1` |
| `Buffer.alloc(4).fill("it's", 'hex')` | `ERR_INVALID_ARG_VALUE` … ``Received "it's"`` (`util.inspect`) | ``Received 'it's'`` (`'${String(v)}'`) |

Browser hosts share the code (not measured). Label gap aside
(`runtime-js/node-error-code-label`), message and `code` differ (both
`once` forms reject). Compat buffer.md `Buffer.alloc` ⚠️ (2026-11-24); `events.once` has no row.

## Next

Owner runtime-js. Trigger: a package handling these errors by `code`, or a
sweep of argument validation against Node's `validators.js`.
