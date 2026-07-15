# ADR 0272: Late typed process terminal bootstrap

Status: Accepted
Date: 2026-07

> TL;DR: custom Node URL entries apply validated PTY metadata through one
> runtime-owned process API; guest env is never a launch-control fallback.

## Context

ADR-0267 moved Node-entry launch metadata out of `process.env` into its exact
URL bootstrap. The dedicated dev-server child has a different, app-owned entry
protocol because it also carries package/runtime configuration. `runtime-js`
cannot validate that higher-layer envelope before constructing `NodeProcess`,
while the Playground entry must shape stdio before importing user code.

The legacy fallback read `RIFTY_*_IS_TTY` and `RIFTY_TTY_*` from every guest
environment lacking a Node-entry envelope. That reinterpreted ordinary Node env
data as host control; a nonnumeric guest value could throw before the custom
entry validated its typed bootstrap.

## Decision

- A process without a runtime-js Node-entry envelope starts with non-TTY stdio
  and the neutral 80×24 grid. No guest env key controls terminal shape.
- `@riftydev/runtime-js/builtins/process` publicly exports
  `applyNodeProcessTerminalBootstrap(process, terminal)`. It requires the
  runtime-owned terminal receiver on its target, snapshots the typed terminal
  record, applies it synchronously, and retains any newer validated resize
  received before the call. It never reads or rewrites `process.env`.
- A custom URL entry validates its own versioned envelope, calls this function
  once, then imports user code. The ordinary Node-entry protocol keeps its
  existing pre-entry path through the same process-owned terminal state.
- Direct symbol invocation is not an API. The exported function is the sole
  cross-package adapter for custom entry protocols.

Rejected: reserved env keys or filtering (contradicts ADR-0267 and repeats
collision drift); teaching runtime-js the Playground dev-server protocol
(reverse ownership); adding Node semantics to `KernelProcessSpec` (kernel
pollution); a second IPC handshake (unneeded ordering/race mechanism).

## Consequences

- Guest env remains exact for Node-entry and custom-entry children, including
  names colliding with former `RIFTY_TTY_*` controls.
- Custom entries can install TTY shape after app-owned validation without
  exposing an undocumented symbol protocol or importing app semantics downward.
- Callers that constructed `NodeProcess` directly with legacy TTY env keys must
  migrate atomically to the typed function; there is no dual-read fallback.
- This is a narrow public host API on an already public subpath. Shape changes
  are observable and require a superseding decision.
