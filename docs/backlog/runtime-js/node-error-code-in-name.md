---
area: runtime-js
status: draft
title: rifty's Node-coded errors print `TypeError: …` where Node prints `TypeError [ERR_…]: …`
created: 2026-11-24
why: Node's internal errors put the code in `stack`'s first line and in `String(err)`; rifty's carry `code` only as a property, so logs, `console.log(err)` and fatal reports differ from Node for every coded error.
sources: [packages/isolate-guest/src/guest/node-validators.ts, packages/runtime-js/src/internal/node-received.ts]
code: [packages/isolate-guest/src/guest/node-validators.ts, packages/runtime-js/src/internal/node-received.ts, packages/io/src/buffer.ts]
---

## Context

Probe 2026-11-24, isolate guest `runCode` vs live `node -e` v24.16.0, per call
`String(e)` and `e.stack.split('\n')[0]`:

| call | Node | rifty |
|---|---|---|
| `require('net').setDefaultAutoSelectFamily(1)` | `TypeError [ERR_INVALID_ARG_TYPE]: The "value" argument must be of type boolean. Received type number (1)` (both) | `TypeError: The "value" …` (both) |
| `require(1)` | `TypeError [ERR_INVALID_ARG_TYPE]: The "id" argument must be of type string. …` | `TypeError: specifier.startsWith is not a function` (no validation) |
| `require('path').join(1)` | `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument …` | returns a string (no validation) |
| `Buffer.alloc(-1)` | `RangeError [ERR_OUT_OF_RANGE]: The value of "size" is out of range. …` | `RangeError: Invalid typed array length: -1` |

Node's `NodeError` captures the stack with `name [code]` and its `toString()` returns
`${name} [${code}]: ${message}`; rifty builds plain `TypeError`/`RangeError` with an own `code`
(`node-validators.ts` `nodeError`, `node-received.ts` `invalidArgType`, ad-hoc `Object.assign`
sites). Silent: `e.code`/`e.message` match, the printed form does not. The last three rows are
missing validation, a wider gap on the same calls.

## Challenge

challenge: 2026-11-24 — none yet (factual capture, unit distribution/isolate-host-egress-modules-load)
