---
area: runtime-js
status: draft
title: "The CJS rewrite of `Function` stays invisible: shorthand keys keep their columns, V8 messages name `Function`"
created: 2026-11-23
why: "`const o = { Function }; new o.Function(…)()` moves the line's columns by 10 and `Function.foo()` reports `$r000000.foo is not a function`; Node: columns as written, `Function.foo is not a function`"
sources: [docs/public/compat/modules.md, docs/backlog/runtime-js/reference/pr-425-final-green.json]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/cjs-source-rewrite.ts]
---

## Context

Found by the PR #425 cross-review (round 1), reproduced 2026-11-23 (isolate
`runCode` vs Node v24.16.0, a file `require`d from `-e`):

- shorthand: corpus row `throw-in-shorthand-function` (`const o = { Function
  }; new o.Function('throw new Error("x")')();`): caller frame rifty
  `<root>/main.js:1:73`, Node `1:63`. The rewrite expands the shorthand to
  `Function: $r000000` (+10); a plain `Function` reference keeps its columns
  (same-length helper, PR #425).
- messages: `try { Function.foo() } catch (e) { console.log(e.message) }` →
  rifty `$r000000.foo is not a function`, Node `Function.foo is not a
  function`. V8 builds the message from the rewritten source text.

Present before PR #425 with the old helper name (`__riftyFunction`). Fault
class `provenance-lie` at the CJS rewrite boundary.

Owner: runtime-js (module loader, Function routing). Trigger: an agent misled
by a message or column on a line naming `Function`, or the next change to the
Function routing (`runtime-js/new-function-eval-origin`).

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
