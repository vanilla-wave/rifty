---
area: runtime-js
status: draft
title: "`process.getBuiltinModule(id)` returns the builtin as in Node"
created: 2026-11-24
why: Node 24 has `process.getBuiltinModule` (libraries use it to reach `fs` without `require`); rifty's `process` has none on any host, so the call throws `TypeError: process.getBuiltinModule is not a function`
sources: [docs/backlog/runtime-js/isolate-require-esm-syntax-gaps.md]
code: [packages/runtime-js/src/builtins/process.ts]
---

## Context

Found by the PR #440 review, round 2 (2026-11-24), outside its unit. `runCode("console.log(typeof
process.getBuiltinModule)")` → `undefined`, a call → `TypeError: process.getBuiltinModule is not a
function`; Node v24.16.0: `function`, `getBuiltinModule('fs').readFileSync` a function. No source in
`packages/runtime-js/src` names it (code read: every host). Owner: runtime-js process. Trigger: a
package calling it. No compat row yet.
