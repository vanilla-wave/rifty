---
area: runtime-js
status: draft
title: Optional print before a program entry must preserve Node execArgv
created: 2026-07-30
why: Node accepts `node -p/--print[=rhs] -- <file>`, but node-entry v3 programs cannot carry the retained print option without lying about process identity.
user_story: As a CLI author running `node -p -- script.cjs`, I want the file to execute with Node's exact `process.execArgv`, but today Rifty stops at a named unsupported context.
sources: [M11, ADR-0267, ADR-0337, docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md]
code: [packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/process.ts, packages/workbench/src/workers/node-entry-resolve.ts, packages/workbench/src/workers/workbench-project-runtime.ts]
---

## Context

Node v24.16.0 treats every optional print spelling followed by
`-- <nonempty entry>` as program mode, retains the exact print token in
`process.execArgv`, resolves the entry, and does not print eval's `undefined`.
An empty first token after `--` instead remains entryless eval and is covered by
`runtime-js/node-cli-eval-identity-parity`.

Node-entry v3's exact-own program launch has no `execArgv`; runtime-js seeds
programs with `[]`. Reusing that launch would falsely claim Node identity, while
adding a permissive field or side channel contradicts ADR-0267/0337. Rifty
therefore throws
`NotImplementedError('workbench.node.print-program-context')` before Worker
allocation and records compat ❌.

No matching backlog item, epic child, or protocol/`execArgv` boundary was found
on 2026-07-30. The native artifact and CI-active CLI-report Chromium case give
the user-action path. A faithful contract must decide and record the atomic
node-entry protocol revision (including every program producer) before
implementation; no coordination mechanism is proposed here.
