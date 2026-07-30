# ADR 0341: Project terminal runs expose authoritative shell status

Status: Accepted
Date: 2026-07

> TL;DR: `ProjectTerminalRun` exposes the owner-authored shell status beside
> its exact physical exit; consumers never reconstruct one from the other.

## Context

ADR-0257 keeps two independent facts on `pty:exit`: numeric shell status and
the final command's exact `{ code, signal }`. Owned Ctrl-C is the distinguishing
case: Shell returns status `130` while the supervised child reports physical
`SIGTERM`.

`ProjectTerminalPort.execResult()` received both, but `createProjectTerminal()`
discarded the status and exposed only `ProjectTerminalRun.exited`. Playground
then reconstructed a number from the physical exit and recorded `1` for Ctrl-C.
That loses owner state above the already-correct PTY boundary.

## Decision

Add one additive public field:

```ts
interface ProjectTerminalRun {
  readonly exitCode: Promise<number>
  readonly exited: Promise<ProcessExit>
  // ready/stop/close unchanged
}
```

`createProjectTerminal()` resolves both promises from the same authoritative
`ProjectTerminalPort.execResult()` settlement and rejects both on the same
run/transport failures. `exitCode` carries the Shell-owned numeric status;
`exited`, `stop()`, and `close()` retain exact physical provenance.

Playground interactive terminals use `exitCode` for the returned line result,
session state, and history. No consumer derives it from `ProcessExit`.

Rejected: widening `exited` breaks its accepted exact-exit API; an app-local
sid/rid registry duplicates PTY correlation; signal-to-number projection
contradicts ADR-0257.

## Consequences

- Ctrl-C history records `130` while lifecycle callers still observe physical
  `SIGTERM`.
- Existing exact-exit consumers remain source-compatible; typed
  `ProjectTerminalRun` producers must provide the new promise.
- The owner/PTY result remains the sole status authority; no new lifecycle
  mechanism or state registry is added.
