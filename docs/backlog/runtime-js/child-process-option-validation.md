---
area: runtime-js
status: draft
title: child_process spawn/fork option validation — unrecognized `serialization` silently accepted
created: 2026-10-02
why: Node throws `ERR_INVALID_ARG_VALUE` for `fork(child, [], { serialization: 'bogus' })` (host probe 2026-10-02, Node v24.16.0); rifty silently accepts any non-`'advanced'` value and spawns a JSON child — silent divergence, gap stays invisible
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/child-process-advanced-ipc-serialization.md]
code: [packages/runtime-js/src/builtins/child_process.ts]
---

## Finding

Found during `child-process-advanced-ipc-serialization` (vitest-run-in-browser
I4): `spawn` validates only `serialization === 'advanced'`
(child_process.ts:324); `'bogus'` passes and spawns. Node v24.16.0 validates
the option value loudly.

Adjacent class: other fork/spawn options likely share the silent-accept
shape; validate against Node per option at implementation.

## Trigger

Next unit touching `child_process.ts` option parsing, or a parity case for
option validation. Not on the vitest acceptance path (vitest only passes
`'advanced'` or omits).