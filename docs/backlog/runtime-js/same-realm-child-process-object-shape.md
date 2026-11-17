---
area: runtime-js
status: draft
title: A same-realm (no-COI) child's `process` is a plain object with bare `{write}` stdio and no `NodeProcess` members
created: 2026-09-24
why: on the same-realm fallback route the child's `process` / `require('process')` is a hand-built object — `stdout`/`stderr` are `{ write }` only, so `src.pipe(process.stdout)` throws `dest.on is not a function`, and members the Worker route has (`memoryUsage`, Writable surface, …) are absent
sources: [docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md, docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-final-green.json, docs/backlog/runtime-js/reference/absent-builtin-members-loud-throws-evidence.md, docs/backlog/kernel/process-equals-web-worker.md]
code: [packages/runtime-js/src/builtins/child_process-exec.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md`
(vitest-run-in-browser item 6, Final+GREEN concern; evidence §Final+GREEN
r1 reception "Sibling sweep"); also named in
absent-builtin-members-loud-throws contract Out of scope (at `57f6117de`; no
`memoryUsage`). Code reading @ `8c8993649`: `child_process-exec.ts:289-296`
builds `childProcess = { argv, env, pid, ppid, stdin, stdout: { write },
stderr: { write }, cwd, on, … }`; the child's `require('process')` /
`require('node:process')` returns it (`:496`), bypassing the registry
entry. The claimed paths fork through the kernel Worker route
(`NodeProcess`); this route runs only without a physical Worker
(`kernel/process-equals-web-worker`: honest degraded mode, warned once).

Not executed here: `Readable.pipe` (`packages/io/src/streams/readable.ts`
`pipe`) calls `dest.on('drain'|'error'|'close', …)`, which a `{ write }`
object lacks — the throw is code reading plus the u6 unit's scratch note.

2026-11-17 — declared residual of the process brand fix (ADR-0345
§Corrections; parity `process/to-string-tag-same-realm`): the child's object
now carries Node's `Symbol.toStringTag` brand but has no `versions`. Scratch
same-realm parity case (seeded mode), Node v24.16.0 vs rifty, pdfjs-dist's
`isNodeJS` expression: Node `true`; rifty before the fix (`dc69559b9`) `false`,
after `TypeError: Cannot read properties of undefined (reading 'nw')`;
`typeof process.versions` `object` · `undefined`. Packages cannot load here:
`require('./dep.js')` → `NotImplementedError: child_process.same-realm.require`
(Node: the module), so only inline child code reaches the throw. Kill: the
child's object carries `versions` (and the other shared identity fields).

## Next

Owner runtime-js. Trigger: a no-COI program piping into its own
`process.stdout`, or reading a `NodeProcess` member in a same-realm child
(including a brand-based Node detector reading `process.versions`); or a
decision in `kernel/process-equals-web-worker` retiring the route.
Parity first on the same-realm route: `pipe(process.stdout)`,
`typeof process.memoryUsage`, `typeof process.versions`, the `isNodeJS`
expression, `Object.keys(process)` subset vs the Worker route.
