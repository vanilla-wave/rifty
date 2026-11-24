---
area: runtime-js
status: draft
title: rifty's util.format('%s') differs from Node's for objects with their own toString/toPrimitive, class instances, -0 and nested objects
created: 2026-11-24
why: `%s` is how Node builds its own error messages and how CLIs log; rifty inspects where Node calls the value's toString or Symbol.toPrimitive, and prints -0 as 0 — silent, on every host.
sources: [packages/isolate-host/tests/egress-modules.test.ts, "PR #435 external review round 2"]
code: [packages/runtime-js/src/builtins/util.ts, packages/isolate-guest/src/guest/egress-http.ts]
---

## Context

Probe 2026-11-24, isolate guest `runCode` vs live `node -e` v24.16.0, `util.format('%s', v)`:

| `v` | Node | rifty |
|---|---|---|
| `{ toString() { return 'o' } }` | `o` | `{ toString: [Function: toString] }` |
| `new (class A { toString() { return 'A' } })()` | `A` | `A {}` |
| `{ [Symbol.toPrimitive]: () => 'p' }` | `p` | `{}` |
| `-0` | `-0` | `0` |
| `new Number(5)` | `[Number: 5]` | `Number {}` |
| `{ a: Object.create(null) }` | `{ a: [Object: null prototype] {} }` | `{ a: [Object] }` |
| an `Error` with `code` and `cause` (fixed `stack`) | stack + `{ code: …, [cause]: … }` | the stack alone |

Node's `%s` (`formatWithOptionsInternal`): a number via `formatNumber` (`-0`), a bigint `<n>n`,
a non-object or an object without a built-in `toString` (`hasBuiltInToString`) via `String()`,
otherwise `inspect(v, { depth: 0, colors: false, compact: 3 })`; the last three rows are also
`util.inspect` gaps (`backlog/runtime-js/inspect-null-prototype-prefix`). Reached by the isolate
guest's `http.validateHeaderName`/`validateHeaderValue` messages (`TODO(backlog: …)` there),
declared rows in `egress-modules.test.ts` `DECLARED_FORMAT_ROWS` — a fix turns them red.

## Challenge

challenge: 2026-11-24 — none yet (factual capture, unit distribution/isolate-host-egress-modules-load)
