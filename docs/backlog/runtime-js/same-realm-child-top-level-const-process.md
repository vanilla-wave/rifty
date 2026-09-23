---
area: runtime-js
status: draft
title: A same-realm fork child's top-level `const process` (or `setTimeout`, `global`, …) is a SyntaxError
created: 2026-09-23
why: Node's CJS wrapper binds only `exports, require, module, __filename, __dirname`, so a top-level `const process = require('node:process')` is legal; rifty's same-realm child wrapper passes `process` and timer/global names as `new Function` parameters, so the declaration throws before the child runs
sources: [docs/backlog/runtime-js/child-process-advanced-ipc-serialization.md, docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-final-green.json]
code: [packages/runtime-js/src/builtins/child_process-exec.ts]
---

## Context

REV-12 discovery of `runtime-js/child-process-advanced-ipc-serialization`
(contract Decisions). The same-realm child body is compiled as
`new Function('__stdout_write', …, 'process', 'setTimeout', …, 'globalThis',
'global', 'self', 'require', code)` (`child_process-exec.ts:454-468`); a
lexical top-level declaration of any of those names collides with the
parameter (`Identifier 'process' has already been declared`). The Worker
route is unaffected.

## Next

Owner runtime-js; trigger: a same-realm (no-COI) fork of a program that
declares `process` at top level, or the next same-realm child unit. Parity
case on the same-realm route first.
