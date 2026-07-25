---
area: runtime-js
status: draft
title: Owner-backed remote FS for generic Worker Node children
created: 2026-06-17
why: generic `spawn('node', …)` and `fork()` still loud-throw when a real Worker route exists because the child has no proven route to the parent-owned VFS
epic: real-node-server-dev-loop
sources: [ADR-0011, ADR-0137, ADR-0150, ADR-0267]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/ipc/sync-rpc-fs.ts, apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/workers/node-entry-remote-fs.ts, apps/playground/src/workers/workbench-project-runtime.ts]
---

## Context

Current `child_process.spawn` throws
`NotImplementedError('child_process.spawn[worker]')` when SAB and node-entry
Worker URLs are available. The former generic route could only give the new
realm a private empty mirror; that would silently violate Node's shared
filesystem namespace.

ADR-0267 replaced guest-env launch controls with a versioned entry bootstrap,
fresh launch metadata, and exact guest `process.env`. Current Playground
entries also carry a typed remote-FS root into `node-entry-remote-fs`; the old
PR #129 guest-env/private-mirror mechanism is therefore invalid. This item owns
only recursive Worker launch and VFS provenance: the child resolves the same
owner-backed namespace, forwards recursive descendants through the current
relay, never
opens a second OPFS owner, and fails before PID/Worker allocation when a complete
route cannot be proven. Public cwd/env/stdio/IPC/process-table and terminal
settlement belong to `runtime-js/worker-child-process-contract`.

Real-Worker browser proof also owns the former residual conformance scope:
parent writes followed by child sync reads, chunk boundaries, short/no-progress
reads, concurrent size changes, error metadata, and readdir/stat shapes. The
Workbench content snapshot plane remains a separate document transport and is
never a child-process filesystem fallback.

`kernel/process-equals-web-worker` separately owns retirement of the non-Worker
fallback; this item proves and enables the real Worker route without changing
that fallback policy.

The transport/bootstrap change is public and cross-package; a fresh ADR
composing ADR-0267 is required before this item can become `ready`. If
refinement finds a real contradiction, it must use the superseding-ADR process.
