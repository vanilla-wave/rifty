# ADR 0225: Cross-realm PTY resize control plane

Status: Accepted
Date: 2026-07

> TL;DR: one owner-resident PTY actor retains the latest terminal dimensions;
> `pty:resize` crosses the kernel on a process-control frame and updates the
> active child's TTY, stream `resize`, and `SIGWINCH` without depending on
> logical Node IPC connectivity.

## Context

Workbench terminal resize must affect the running program, not only the next
command. A foreground command may run in the owner shell, a kernel Node child,
or a supervised dev-server/bin child. A page-side remembered size and a worker
handle whose transport dies on `process.disconnect()` both claim behavior the
program cannot observe.

The Workbench recut gives each terminal one `PtySessionActor`; resize needs one
run-scoped authority and an explicit cross-realm control plane.

## Decision

- The owner-resident `PtySessionActor` owns the current dimensions and active
  run. A resize before child readiness is latched; the latest dimensions apply
  when it attaches. Close/exit tears the source down exactly once.
- Add `pty:resize { sid, rid, cols, rows }`. The run id fences late frames from
  a replacement command. Dimensions are positive safe integers; invalid frames
  fail loudly.
- Each active run carries one mutable `TerminalResizeSource` through
  `CommandContext`. TTY readers observe current values; redirected/non-TTY
  stages do not receive it.
- Add `WorkerProcessHandle.resize(cols, rows)`. It sends internal
  `ipc:tty-resize` over the physical process-control channel, which remains
  open after logical user IPC disconnect and closes only on process exit/kill.
- Runtime-js updates TTY stdout/stderr `columns`, `rows`, and
  `getWindowSize()`, emits stream `resize`, then process `SIGWINCH` in the
  Node-parity order. Non-TTY streams remain unchanged.
- Node/bin/dev-server adapters subscribe only for their active run, forward to
  the child handle, and unsubscribe on every completion/abort path. A live
  resize API never degrades to a remembered-only no-op.

## Consequences

- Long-running Node programs observe the dimensions displayed by the host,
  including resize after logical IPC disconnect.
- Run ids and one actor prevent stale delivery and same-tick double-run races.
- TTY parity plus real worker/browser tests are required; a page-only mock does
  not prove this cross-realm contract.
