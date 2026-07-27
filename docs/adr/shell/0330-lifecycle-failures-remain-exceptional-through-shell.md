# ADR 0330: Lifecycle failures remain exceptional through Shell

Status: Accepted
Date: 2026-07-27

> TL;DR: loss of foreground process authority rejects Shell with a typed
> lifecycle error; it never becomes an invented command exit.

## Context

ADR-0257 distinguishes exact process exit from owner death, but Shell could not
carry that distinction through composition. Mapping a closed Worker peer to a
numeric status would invent Node behavior. A generic `Error` cannot survive
namespace translation or mixed cleanup `AggregateError` without the host
guessing from messages.

## Decision

- `@riftydev/shell` exports `ShellCommandLifecycleError` for loss of authority
  over a foreground command before a process exit exists.
- Shell rethrows that error, including when nested in `AggregateError`; normal
  command errors and real non-zero exits keep their existing result semantics.
- Hosts may translate public path text but preserve the error class and cause.

## Consequences

- Peer death cannot masquerade as success or failure status.
- The class is a cross-package public contract; new lifecycle categories extend
  it explicitly rather than relying on message matching.
