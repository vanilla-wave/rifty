---
area: runtime-js
status: draft
title: "`spawn`/`fork` stdio stream slots follow Node (fd share or `ERR_INVALID_ARG_VALUE`), and the same-realm route forwards stdin"
created: 2026-09-24
why: rifty reads any Readable in a stdio slot with a `'data'` listener (flowing, parent consumes it) where Node shares the stream's fd or rejects a stream without one; the same-realm route never forwards an inherited or supplied stdin to the child
sources: [docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md]
code: [packages/runtime-js/src/builtins/child_process-worker.ts, packages/runtime-js/src/builtins/child_process.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md`
(vitest-run-in-browser item 9, Final+GREEN); outside that unit, which
fixed only default inherited stdin (`process-stdin-inherit.ts`, evidence
§Inherited stdin). Code reading @ `8c8993649`:

- Worker route: `input()` (`child_process-worker.ts:153-167`) accepts any
  readable object; `forward()` attaches `source.on('data')` (`:298`).
- Same-realm route: `spawnViaSameRealm` (`child_process.ts`) forwards
  `stdio.stdout`/`stdio.stderr` (`:459`) but never `stdio.stdin`.

Node v24.16.0 probe 2026-09-24 (`fork(child, [], { stdio: [X, …, 'ipc'] })`):

```
X = Readable.from(['x'])              → TypeError ERR_INVALID_ARG_VALUE The argument 'stdio' is invalid. Received Readable {…
X = fs.createReadStream(f) (opened)   → spawned; parent stream readableFlowing null; child exit 0, still null
```

Rifty side not executed here (code reading only). Compat ⚠️
`docs/public/compat/process.md` "Child stdio and fork IPC" names the gap
(added with this draft).

## Next

Owner runtime-js (child_process). Trigger: a program passing a stream in
`stdio`, or a no-COI fork reading inherited stdin. Parity first
(`child-worker` + same-realm): the two Node rows above, a user Readable's
`readableFlowing` after spawn, and a same-realm child reading inherited
stdin. rifty has no fds: an fd-backed stream needs a decided emulation or
a named throw.
