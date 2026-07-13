# ADR 0257: Exact process exit through shell command results

Status: Accepted
Date: 2026-07

> TL;DR: foreground commands return an exact discriminated `{ code, signal }`;
> Shell carries the final executed result through composition while retaining a
> numeric compatibility status, and PTY transport never reconstructs it later.

## Context

Kernel worker handles already emit Node's mutually exclusive exit pair: natural
exit is `{ code, signal: null }`, signal exit is `{ code: null, signal }`.
Playground's shared foreground driver projected that event to `number`, mapping
every signal exit to success `0`. Shell and `pty:exit` then carried only that
lossy projection, so the Workbench contract's exact `run.exited` result could
not be implemented later without reopening the process/PTY substrate.

An app-local side channel keyed by terminal/run would need to shadow Shell's
`&&`/`||`/`;` and pipeline selection, nested `npm run`, abort precedence, and
background semantics. Shell already owns those rules; duplicating them above
its interface would create a second execution-state owner.

## Decision

- Export `ProcessExitSignal = 'SIGINT' | 'SIGTERM'` and discriminated
  `ProcessExit`: exactly one of numeric `code` or `signal` is non-null.
- `ShellCommand` and `BinExecutor` may return a numeric status or `ProcessExit`.
  Built-ins keep returning numbers. Supervised Node/`.bin`/dev-server adapters
  return the exact child exit born at the handle event, including pre-ready
  dev-server abort/crash. One shared strict normalizer owns all Worker-handle
  exit shaping; invalid pairs and unsupported signals fail loudly.
- `Shell.run()` returns both legacy `exitCode` and exact `exit`. It owns result
  selection across compound commands and pipelines. A normal numeric command
  becomes `{ code, signal: null }`. Detached/cooperative host cancellation is
  `{ code: null, signal: 'SIGINT' }`; owned abort settlement retains a rich
  handler's physical exit while legacy `exitCode` remains the shell's 130.
  Legacy direct signal statuses are 130/143.
- Nested shell adapters forward the rich result instead of re-projecting it to
  `exitCode`. Numeric command statuses obey the same non-negative safe-integer
  invariant as rich code exits.
- `pty:exit` carries its existing `code` shell status and an independent exact
  `exit` pair. The thin client exposes both seams: existing callers consume the
  status; future Workbench handles consume the exact pair. Neither value is
  reconstructed from the other: owned cancellation can be shell status `130`
  while the physical child reports `SIGTERM`.
- Owner death rejects the run as a transport failure; it never fabricates a
  process exit.

## Consequences

- Exact provenance survives from kernel event through foreground driver, Shell,
  owner actor, and PTY wire; PR 3 can implement `ProjectRun.exited` mechanically.
- Shell remains the sole owner of final-command selection; no sid/rid registry
  or callback channel mirrors its execution state.
- The public shell command-result type is additively wider and `RunResult` gains
  `exit`; typed hosts that hard-code `Promise<number>` around child-backed
  commands must retain numeric returns or adopt the rich result.
- Only SIGINT and SIGTERM are supported control signals today. A new signal is
  an explicit interface extension, not a silently guessed numeric status.
