---
area: runtime-js
status: draft
title: util.inspect prints a null-prototype object as `{}`, Node prefixes `[Object: null prototype]`
created: 2026-11-24
why: Every surface built on rifty's inspect (console.log, util.format %s/%o, error messages) silently drops the prefix Node prints; found by the isolate egress-modules parity (header-validation messages).
sources: [packages/isolate-host/tests/egress-modules.test.ts]
code: [packages/runtime-js/src/repl/inspect.ts]
---

## Context

Probe 2026-11-24, isolate guest `runCode` vs live `node -e` v24.16.0:
`console.log(require('util').inspect(Object.create(null)), require('util').inspect({ __proto__: null, a: 1 }))`
→ Node `[Object: null prototype] {} [Object: null prototype] { a: 1 }`, rifty `{} { a: 1 }`.
Reached through Node's `%s`: `http.validateHeaderName(Object.create(null))` → Node
`Header name must be a valid HTTP token ["[Object: null prototype] {}"]`, guest `["{}"]` —
pinned as a declared line in `egress-modules.test.ts` (`declaredBehaviour`); a fix turns it red.
Silent (no throw): a printed value differs from Node. Browser hosts share `repl/inspect.ts` by
source, not probed there.

## Challenge

challenge: 2026-11-24 — none yet (factual capture, unit distribution/isolate-host-egress-modules-load)
