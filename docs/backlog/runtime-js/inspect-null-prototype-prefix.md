---
area: runtime-js
status: draft
title: util.inspect differs from Node for null-prototype objects, boxed primitives, an Error's own props and long strings
created: 2026-11-24
why: Every surface built on rifty's inspect (console.log, util.format %s/%o, Node error messages) prints these shapes differently from Node, silently; found by the isolate egress-modules parity (header-validation and argument-value messages).
sources: [packages/isolate-host/tests/egress-modules.test.ts]
code: [packages/runtime-js/src/repl/inspect.ts]
---

## Context

Probe 2026-11-24, isolate guest `runCode` vs live `node -e` v24.16.0:
`console.log(require('util').inspect(Object.create(null)), require('util').inspect({ __proto__: null, a: 1 }))`
→ Node `[Object: null prototype] {} [Object: null prototype] { a: 1 }`, rifty `{} { a: 1 }`.
More shapes, same probe (`util.inspect(v)` unless noted): `new Number(5)` → Node `[Number: 5]`,
rifty `Number {}` (also `new String('x')` → `[String: 'x']`/`String { 0: 'x' }`, `new Boolean(true)`
→ `[Boolean: true]`/`Boolean {}`); `{ a: Object.create(null) }` at depth 0 (`%s`) → Node
`{ a: [Object: null prototype] {} }`, rifty `{ a: [Object] }`; an `Error` with an own `code` and a
`cause` → Node the stack then `{ code: 'E_BAD', [cause]: … }`, rifty the stack alone; a 140-char
string → Node in full (`maxStringLength` 10 000), rifty cut at ~120 with `…'` (so Node's
`ERR_INVALID_ARG_VALUE` cut at 128 + `...` differs: `new http.Agent({ scheduling: 'x'.repeat(140) })`).
Reached through Node's `%s`: `http.validateHeaderName(Object.create(null))` → Node
`Header name must be a valid HTTP token ["[Object: null prototype] {}"]`, guest `["{}"]` —
rows declared in `egress-modules.test.ts` (`DECLARED_FORMAT_ROWS`); a fix turns them red.
Silent (no throw): a printed value differs from Node. Browser hosts share `repl/inspect.ts` by
source, not probed there.

Also through `%s` (PR #462 review N6, verified in-process 2026-11-26; every host shares the
formatter): `new StringDecoder(Object.create(null))` and `readable.setEncoding(Object.create(null))`
→ Node `Unknown encoding: [Object: null prototype] {}`, rifty `Unknown encoding: {}`.

## Challenge

challenge: 2026-11-24 — none yet (factual capture, unit distribution/isolate-host-egress-modules-load)
