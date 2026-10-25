---
area: runtime-js
status: draft
title: "`worker_threads.Worker`'s `env` option is handled as in Node"
created: 2026-09-25
why: Node gives `env: null`/`undefined` a copy of the parent env and rejects a non-object `env` with `ERR_INVALID_ARG_TYPE`; rifty's kernel-backed constructor throws `TypeError` for `null` (after piping the Worker's streams into the parent's `process.stdout`/`stderr`, left behind) and silently turns a primitive into an env (`5`/`true` → empty, `'ab'` → `{0:'a',1:'b'}`)
sources: [docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-final-green.json, docs/adr/runtime-js/0449-carry-node-startup-options-and-worker-stdio-streams.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/builtins/worker_threads-stdio.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md`
(vitest-run-in-browser item 11; Final+GREEN Bugs concern). Not on vitest's path.

Node v24.16.0 (probe 2026-09-25, `node p.cjs`: `new Worker(path.resolve('w.cjs'), { env })`,
the worker posts `typeof process.env`, `'HOME' in process.env` and a parent-set key):

```text
5 / 'ab' / true / 0 / false / '' / Symbol(s)
  → throw TypeError ERR_INVALID_ARG_TYPE The "options.env" property must be of type
    object or one of undefined, null, or worker_threads.SHARE_ENV. Received type number (5)
    (each value its own `Received …`)
null / undefined → msg {"t":"object","home":true,"x":"parent"}, exit 0
```

Copy vs shared (`node p2.cjs`): with `env: null` and `undefined` the worker
reads the value at construction (a parent write after `new Worker` is not
seen) and its own write never reaches the parent — a copy.

- `env: null` (pre-existing): rifty `snapshotWorkerEnvironment(opts.env)`
  (`worker_threads.ts:55-60`, `Object.entries`) → `TypeError: Cannot convert
  undefined or null to object`.
- Non-object `env` (pre-existing, code reading): `Object.entries` accepts a
  primitive — `5`/`true`/`0`/`false`/`''`/a `Symbol` give an empty env, `'ab'`
  gives `{0:'a',1:'b'}` — a silent lie where Node throws `ERR_INVALID_ARG_TYPE`.
- Torn state (item 11 ordering): the constructor builds `WorkerStdio` (auto-pipe
  into `publicNodeProcess()` streams) before the env snapshot. Reviewer's
  kernel-capable scratch probe: after the `env: null` throw, parent
  `process.stdout` listener counts `[unpipe, close, finish, error]` go
  `[0,0,0,0]` → `[0,1,0,1]` (stderr same path). Stays reachable after the
  `env: null` fix: an env value Node also rejects (`{ A: Symbol('v') }` →
  Node `TypeError: Cannot convert a Symbol value to a string`) throws from
  `String()` after the pipe. Split it out at pickup if it grows.
- `env: worker_threads.SHARE_ENV`: the export is absent (reads `undefined`,
  so a copy) — owned by `runtime-js/perf-worker-reexports`.

## Next

Owner runtime-js. Parity first: a `worker_threads` case with `null`/`undefined`
→ the parent env copy (value at construction; writes not shared) and each
non-object → `ERR_INVALID_ARG_TYPE`. Fault row: a constructor throw after
option validation leaves the parent's stdout/stderr listener counts unchanged
(fix: build `WorkerStdio` after every synchronous validation, beside the
thread id and holds).
