---
area: runtime-js
status: draft
title: Kernel node children's global console skips util.format printf directives
created: 2026-11-18
why: Node's global console is `require('console')` (util.format); kernel node children install the REPL console, which joins arguments without printf formatting.
sources: [docs/public/compat/isolate-host.md]
code: [packages/workbench/src/workers/node-entry-bootstrap.ts, packages/runtime-js/src/repl/console.ts, packages/runtime-js/src/builtins/console.ts]
---

## Context

Node v24.16.0: `node -e "console.log('%s is %d', 'x', 5)"` → `x is 5`.
`node-entry-bootstrap.ts` calls `installConsole` (REPL `formatArgs`: strings
verbatim, others inspected, space-joined) → `%s is %d x 5`. The isolate host
(ADR-0557) instead installs `@riftydev/runtime-js/builtins/console`'s default
instance, which applies `util.format`; its corpus row `console-format` passes.
Not executed on the browser path in this capture — read from code; settle with
a node-cli-eval parity case.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
