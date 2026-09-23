---
area: runtime-js
status: ready
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

## Reference contract

Node v24.16.0; `stream/pipe-process-stdio.case.ts` runs identical source
with real streams/process in both runtimes.

## Acceptance

1. Pipe leaves process stdout/stderr writable even with `{end:true}`; an ordinary Writable with fd=1 still finishes. → I4

## Parity cases

1. Pipe to stdout and stderr, then write again; ordinary fd=1 destination emits finish. Carrier: `stream/pipe-process-stdio`. → I4

## Out of scope

Explicit calls to process stdio `.end()` are not introduced by this repair.

## Decisions

- 2026-09-23 — RDY-8 observed defect: parity RED `TypeError: dest.end is not a function`; native `runInNode` on Node v24.16.0 outputs `stdout-data|stdout-after|stdout-completed`, `stderr-completed`, `ordinary-ended`.
- 2026-09-23 — class `sibling-drift`: same pipe chokepoint handles both process streams; consult existing io builtin registry for exact process stream identities, never fd heuristics. In-process boundary excludes transport faults.
