---
area: runtime-js
status: draft
title: node -e uncaught non-throw error lacks Node's [eval] source header and caret
created: 2026-11-18
why: Node prints `[eval]:1` + source line + caret for any uncaught eval error; rifty prints them only when a `throw` statement encloses the error position.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/module-loader/loader.ts]
---

## Context

Node v24.16.0, `node -e "const o = undefined; o.x"` → stderr
`[eval]:1\nconst o = undefined; o.x\n                       ^\n\nTypeError: Cannot read properties of undefined (reading 'x')\n    at [eval]:1:24\n…`, status 1.
rifty (`projectNodeEvalError`, `origin === 'sync' && thrown === null` branch,
`loader.ts`) keeps only `TypeError: …\n    at [eval]:1:24`. Found by the
isolate-host parity corpus row `type-error` (expected-failure,
`packages/isolate-host/tests/parity.test.ts`); the browser `node -e` path shares
the projection. Open: whether Node's caret is always the user frame column for
non-throw errors (V8 message location), incl. errors raised inside builtins.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
