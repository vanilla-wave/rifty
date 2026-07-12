# ADR 0240: Writable completion separates internal and public phases

Status: Accepted
Date: 2026-07

> TL;DR: A synchronous write hook updates internal state before `write()`
> returns, but drain/callback/error/finish effects cross one deferred boundary.

## Context

ADR-0237 admission makes decoded byte length observable in `write()`'s HWM
return. Node enters an idle `_write` on the caller stack, so a synchronous hook
completion can clear that length before return. Calling the user callback
inline is still wrong: Node publishes it only after `write()` returns. The same
split governs drain, sync errors, cork release, and `_writev` batches.

## Decision

- One completion owner serves scalar `_write` and batch `_writev`.
- Hook completion synchronously clears `writing`/in-flight length and records
  success or error. This internal phase determines the public method return.
- If the hook completed synchronously, public effects run in the next phase;
  async completion publishes on the completing callback's stack.
- Success publishes owed `drain` before chunk callbacks. Error publishes the
  failing and queued callbacks FIFO before `error→close`, with no drain.
- One FIFO queue owns `end` callbacks: success receives `null` before `finish`;
  pending end after sync-write error uses the deferred public boundary;
  async-final error uses its completion stack; sync-final error publishes after
  close; clean destroy uses `ERR_STREAM_DESTROYED`.
- Finalization waits for the same public boundary; natural Writable close sets
  `destroyed`/`closed`; one idempotent close owner survives listener reentrancy.

## Consequences

- Node HWM returns no longer require early user-callback reentrancy.
- Writable, Duplex, Transform, scalar, and batch paths share one ordering rule.
- `writableNeedDrain` and the broader public state projection remain
  `runtime-js/writable-sync-dispatch-state`.

## Rejected

- Defer the whole drain: loses sync-hook state needed by `write()` return.
- Publish callbacks inline: permits reentrancy before the public call returns.
- Separate scalar/batch schedulers: repeats the sibling-drift fault class.
