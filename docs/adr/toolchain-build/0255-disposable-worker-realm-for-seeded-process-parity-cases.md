# ADR 0255: Disposable worker realm for seeded-process parity cases

Status: Accepted
Date: 2026-07

> TL;DR: Run stdin and TTY-resize parity cases in a disposable Node Worker and
> settle only after termination; same-realm cleanup cannot stop guest work.

## Context

`runInRifty` evaluates modules in the parity process. Cases with injected stdin
or TTY resize seed a process plus MessagePorts. A failure or parent deadline can
settle while guest timers or ESM evaluation remain live. Cleanup then restores
shared timers, console, process, VFS, and keepalive state beneath that code; it
can later write into the next case or mutate its refcount. A promise race only
changes which promise settles and cannot stop JavaScript in one realm.

## Decision

Every seeded-process case (`stdin` present or `kind: 'tty-resize'`) uses one Node
`Worker`. The Worker runs the existing in-realm executor and reports its outcome.
The parent owns the finite case deadline and always awaits `worker.terminate()`
before resolving or rejecting, including failure and timeout paths.

Stdin feed completion uses a receiver-side ACK on the hidden stdin MessagePort,
registered after the runtime receiver. It never installs a listener on public
`process.stdin`; guest listener counts and removal remain Node-observable state.

The injected `createMessageChannel` fault seam remains same-realm so tests can
exercise partial acquisition and exact LIFO unwind; production cases never use
that seam. Timer properties still restore exact descriptors inside the executor
so the local fault path obeys the same ownership contract.

## Consequences

- Failed or timed-out guest callbacks die with the realm before the next case.
- Stdin and TTY-resize cases pay Worker startup and fresh module initialisation.
- Stdin delivery timeout covers receiver transport processing; the case deadline
  covers a guest that does not consume EOF or otherwise settle.
- `tsx` loads the TypeScript Worker entry; it is already the harness runner.
