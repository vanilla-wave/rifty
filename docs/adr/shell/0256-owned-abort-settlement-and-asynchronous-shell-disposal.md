# ADR 0256: Owned abort settlement and asynchronous shell disposal

Status: Accepted
Date: 2026-07

> TL;DR: hosts that own physical children can keep an aborted shell run pending
> until its handler settles, and `Shell.dispose()` resolves only after every
> aborted background job has physically settled.

## Context

The default shell cancellation contract intentionally returns exit 130 promptly,
even when a non-cooperative handler remains pending. A workspace-owner PTY has a
stronger close contract: it cannot ACK teardown while a supervised Worker, or a
background job owning one, still exists. Aborting the handler and returning
immediately makes owner/session closure observably precede physical process exit.

That stronger ownership cannot be hidden behind the old `dispose(): void` return
shape: a caller needs an awaitable completion proof. Both shapes are public
`@riftydev/shell` API and therefore require an explicit decision.

## Decision

- Add `RunOptions.awaitAbortSettlement?: boolean`. Default `false` preserves the
  prompt exit-130 contract. When `true`, an abort first reaches `ctx.signal`, then
  `Shell.run()` remains owned until that command handler settles; the successful
  abort outcome is still exit 130.
- Background-job clones always enable owned abort settlement. `Shell.dispose()`
  synchronously aborts every running job, returns `Promise<void>`, and resolves
  after all recorded job completions settle.
- PTY/session owners await `dispose()` before acknowledging close. Callers that do
  not need a completion barrier may ignore the returned promise; abort dispatch
  remains synchronous.
- This API does not synthesize child exit. The command/executor must still settle
  from the real physical child exit event (ADR-0230).

## Consequences

- (+) Session close and owner teardown have one awaitable physical-lifetime proof,
  including background supervised children.
- (+) Existing prompt-style callers retain the default fast-abort behavior.
- (-) `Shell.dispose()` changes from `void` to `Promise<void>`; typed consumers
  that asserted the old return value must migrate, while fire-and-forget calls
  keep their immediate abort effect.
- Builds on ADR-0089 cancellation and ADR-0230 child ownership; no new process or
  wire protocol.
