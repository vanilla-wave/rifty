---
area: runtime-js
status: draft
title: `child_process.fork` with `serialization: 'advanced'` round-trips structured-clone values
created: 2026-09-15
why: vitest's default forks pool calls `fork(entry, [], { env, execArgv, stdio: 'pipe', serialization: 'advanced' })`; rifty throws `NotImplementedError('child_process.serialization.advanced')` at spawn, so the default pool cannot start
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/internal/node-ipc-serialization.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

Oracle (Node v24.16.0, evidence §Oracle): `fork(child, [], { serialization:
'advanced', stdio: 'pipe' })` round-trips `Date`, `Map`, `[undefined]`,
`Uint8Array` with their types intact (`[true,true,true,true]`), and
`send(() => {})` throws `ERR_INVALID_ARG_TYPE`. Browser twin of the v8
serializer is structured clone. The kernel channel already carries
structured-clone frames; the child side switches by launch kind
(`process.ts` `#jsonIpc`), the parent side JSON round-trips every message
(`node-ipc-serialization.ts`) and refuses the option at spawn. Constraint for
pickup: same channel, ordering and disconnect semantics as the JSON path — no
new coordination mechanism (Class-kill note); the JSON default is untouched.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P4 cost shown)
