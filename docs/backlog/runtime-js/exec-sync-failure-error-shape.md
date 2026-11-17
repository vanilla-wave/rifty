---
area: runtime-js
status: draft
title: COI execSync failure error message and code match Node
created: 2026-11-17
why: a failing `execSync` child throws `Command failed with exit code N: cmd` with code ECHILDFAILED; Node throws `Command failed: cmd\n<stderr>` with status/stderr/stdout
sources: [docs/adr/kernel/0011-sync-ipc-sab-atomics.md, docs/public/compat/process.md, docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md]
code: [packages/runtime-js/src/ipc/handlers.ts, packages/runtime-js/src/builtins/child_process-sync.ts, packages/kernel/src/ipc/sync-dispatch.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), verified by the
sweep's independent verifier. COI `execSync('node fail.js')` reaches
`installRuntimeJsExecSyncHandler` (`handlers.ts`), which on non-zero exit
throws `Error('Command failed with exit code ${code}: ${cmd}\n${stderr.trimEnd()}')`
with `code: 'ECHILDFAILED'`, `exitCode`; the kernel forwards
`{name, message, code, errno, syscall, path}` (`sync-dispatch.ts:416`), so the
guest sees `e.code === 'ECHILDFAILED'` (Node: undefined) and no `exitCode`.
Node v24.16.0 (probe: child writes `﻿boom\n` to stderr, exits 3,
`execSync('node fail.js', { stdio: 'pipe' })`): `e.message === "Command failed: node fail.js\n﻿boom\n"`,
plus `e.status`, `e.stderr`, `e.stdout` Buffers. The async path already uses
Node's format (`child_process-output.ts`). The BOM in the stderr tail is kept
since this fix (`handlers.test.ts`). No compat row states the error shape.

Dedup: the missing `status`/`stderr`/`stdout` are the error half of the
stdout-only sync-child protocol already named in compat `process.md:118`
(`spawnSync` ❌) and `node-builtins-loud-stub-capability-gaps.md:18`; this item
owns the thrown error's message/code shape, which needs no new protocol.

## Next

Owner runtime-js; trigger: a claimed program that reads `e.status` /
`e.stderr` or matches the message of a failing `execSync`. RED first: an
`exec-sync` parity case with a failing child.
