---
area: runtime-js
status: draft
title: A same-realm child's `process` is a plain object without most `NodeProcess` members and identity fields
created: 2026-09-24
why: on the same-realm fallback route the child's `process` / `require('process')` is a hand-built object — members the Worker route has (`memoryUsage`, `version`, `platform`, `release`, …) are absent
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

Since `5e7da8be1` (2026-10-20) the child's stdout/stderr are
`makeStdioWriter(…)` EventEmitters, so the original `{ write }` /
`dest.on is not a function` headline no longer holds. 2026-11-17 scratch
same-realm parity case (seeded mode), Node v24.16.0 vs rifty:
`Readable.from(['piped\n']).pipe(process.stdout)` prints `piped` on both;
`typeof process.stdout.on` `function` on both; `typeof process.memoryUsage` /
`process.version` / `process.release` / `process.platform` Node
`function`/`string`/`object`/`string` · rifty all `undefined`.

2026-11-17 — the process brand fix (ADR-0345 §Corrections; parity
`process/to-string-tag-same-realm`) gives the child's object Node's
`Symbol.toStringTag` brand and an own `versions` copy, so pdfjs-dist's
`isNodeJS` expression is `true` as in Node (brand without `versions` threw
`TypeError … (reading 'nw')`; before the fix `false`). Other `NodeProcess`
identity fields stay absent (`version`, `platform`, `arch`, `release`, …).
Only builtins load in this child: `require('./dep.js')` →
`NotImplementedError: child_process.same-realm.require` (Node: the module).

## Next

Owner runtime-js. Trigger: reading a `NodeProcess` member in a same-realm
child (including an identity field such as `process.version`); or a decision
in `kernel/process-equals-web-worker` retiring the route.
Parity first on the same-realm route: `typeof process.memoryUsage`,
`typeof process.version`/`platform`/`release`, `Object.keys(process)` subset
vs the Worker route.
