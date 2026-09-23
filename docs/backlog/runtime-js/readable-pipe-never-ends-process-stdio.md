---
area: runtime-js
status: draft
title: `Readable.pipe(process.stdout|stderr)` never calls `end()` on the process streams
created: 2026-09-15
why: rifty's pipe ends the destination on source end unconditionally; Node exempts process.stdout/stderr (`doEnd = end !== false && dest !== process.stdout && dest !== process.stderr`); vitest pipes each pool child's stdout into process.stdout and crashes with "dest.end is not a function"
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md]
code: [packages/io/src/streams/readable.ts, packages/runtime-js/src/builtins/process.ts]
---

## User scenario

Vitest 4.1.11 pipes each pool child's stdout/stderr to its own
`process.stdout`/`process.stderr`. A source reaching EOF must leave those
process streams writable, so the reporter can emit later results without a
`dest.end is not a function` crash. → I4

## Reference contract

Node v24.16.0 exempts only the current process stdout/stderr object identities
from pipe's default destination end, even with `{ end: true }`. A normal
`Writable` with `fd = 1` still reaches `finish`. The oracle and executed RED
are in `reference/readable-pipe-never-ends-process-stdio-evidence.md`; the
`stream/pipe-process-stdio` parity case executes the same three programs in
real Node and a physical rifty Node Worker.

## Acceptance

1. `Readable.pipe(process.stdout, { end: true })` does not end the process
   stream; a later write reaches stdout and the program exits 0. → I4
2. The same behavior holds for `process.stderr`, with a later write on
   stderr and exit 0. → I4
3. Exemption is object identity, not `fd`, missing `end`, or another shape:
   an ordinary `Writable` with `fd = 1` still receives `end` and emits
   `finish`. → I4

## Parity cases

1. Node v24.16.0 and rifty physical Node Worker run the same stdout pipe,
   source EOF, later write, and exit. RED: `dest.end is not a function` in
   rifty after the first chunk. → I4
2. Same physical parity for stderr. RED is the same wrong `dest.end` call.
   → I4
3. Same physical parity for a normal `Writable` given `fd = 1`; it must
   finish in both runtimes. → I4

## Out of scope

- Direct `process.stdout.end()` and `process.stderr.end()` remain separate
  unimplemented NodeStdioWriter behavior; this unit never calls them. The
  claimed Vitest path uses only `pipe()` and `write()`.

## Decisions

- 2026-09-23 — carrier: `@riftydev/io` compares destination against current global process stream identities; no runtime-js reverse import or fd heuristic.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)
