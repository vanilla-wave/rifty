# ADR 0225: Cross-realm PTY resize control plane

Status: Accepted
Date: 2026-07

> TL;DR: `pty:resize` updates one active PTY run, crosses the kernel on a
> dedicated `ipc:tty-resize` control frame, mutates the child process's TTY
> dimensions, emits stream `resize` plus process `SIGWINCH`, and reaches nested
> foreground children through one run-scoped terminal-size source.

## Context

The public workbench terminal interface requires live `resize(cols, rows)`.
The owner PTY previously accepted dimensions only on `pty:exec`; changing the
page grid mid-command could either be ignored or affect only the next command.
Both would claim a PTY behavior the running program never observes. A real
foreground command may live in the owner shell, a kernel-spawned Node child, or
a supervised dev-server/bin child, so resize needs an explicit cross-realm
control plane.

This adds public kernel and shell interfaces and is irreversible.

## Decision

- Add `pty:resize { sid, rid, cols, rows }`. The run id prevents a late resize
  from mutating a replacement foreground command. Dimensions must be positive
  safe integers; invalid frames fail loudly.
- Each active PTY run owns one mutable `TerminalResizeSource`. `Shell.run()`
  carries it through `CommandContext`; `cols`/`rows` read the current value,
  not a boot-time copy. Redirected/non-TTY stages do not receive it.
- Add `WorkerProcessHandle.resize(cols, rows)`. It sends an internal
  `ipc:tty-resize` frame on the process control channel even after user IPC was
  disconnected; process exit/kill closes the control channel.
- Runtime-js applies the frame to TTY stdout/stderr `columns`, `rows`, and
  `getWindowSize()`, emits each stream's `resize`, then emits process
  `SIGWINCH`. Non-TTY streams are unchanged.
- Foreground node/bin/dev-server adapters subscribe for the active run only,
  forward updates to the child handle, and unsubscribe on completion or abort.
  No remembered-only fallback or silent no-op is exposed as live resize.

## Consequences

- Programs observe the same dimensions the host terminal displays, including
  during a long-running command; terminal layout libraries can react through
  ordinary Node TTY events.
- Resize control is ordered with process IPC and is torn down with the process,
  avoiding a second transport and stale-run delivery.
- The kernel handle and shell command context grow an additive public method and
  source interface; adapters that spawn foreground children must forward it to
  claim live resize.
