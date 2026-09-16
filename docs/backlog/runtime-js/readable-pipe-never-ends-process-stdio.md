---
area: runtime-js
status: draft
title: `Readable.pipe(process.stdout|stderr)` never calls `end()` on the process streams
created: 2026-09-15
why: rifty's pipe ends the destination on source end unconditionally; Node exempts process.stdout/stderr (`doEnd = end !== false && dest !== process.stdout && dest !== process.stderr`); vitest pipes each pool child's stdout into process.stdout and crashes with "dest.end is not a function"
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/io/src/streams/readable.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

`readable.ts` `pipe`: `const endOnFinish = opts.end ?? true; … if
(endOnFinish) dest.end()`. Repro: `Readable.from(['a']).pipe(process.stdout)`
→ `aTypeError: dest.end is not a function`, exit 1. Oracle (Node v24.16.0, evidence §Oracle): `Readable.from(['a\n']).pipe(process.stdout)`
then a later `process.stdout.write('still-writable\n')` prints both lines and
`typeof process.stdout.end === 'function'` — pipe never ends the process
streams although `end` exists. rifty's process streams expose no `end` at all
(`typeof process.stdout.end === 'undefined'`).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)
