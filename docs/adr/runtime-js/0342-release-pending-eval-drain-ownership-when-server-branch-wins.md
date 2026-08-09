# ADR 0342: Release pending eval drain ownership when server branch wins

Status: Accepted
Date: 2026-07-30

> TL;DR: Workbench explicitly releases runtime-js's identity-scoped eval drain
> lease when a listened port wins, handing any claimed terminal to the served
> direct-exit path.

## Context

ADR-0339 defers `-p` output through the child lifecycle. ADR-0155's
run-vs-serve owner may start `awaitDrain()` after eval returns, then observe an
asynchronously registered port and choose the server branch. A boolean
"drain active" flag leaves that pending drain authoritative after its caller
returns: late exit/error is recorded for an orphan, so no physical terminal is
sent. Merely clearing the flag is insufficient because the queued drain can
later flush the result itself. A terminal can also be claimed synchronously in
the `listen()` callback before the server continuation releases ownership.

Workbench owns the server decision; runtime-js owns eval print/terminal state.
The handoff therefore needs one exact cross-package capability.

## Decision

- Each `awaitDrain()` started with a live eval lifecycle owns an
  invocation-identity lease, replacing the shared active boolean. Every tick
  verifies that exact lease before it may flush, project, or settle a terminal.
- Runtime-js exports `releaseNodeEvalDrainOwnership(): void` from its package
  root. `runNodeProgramLifecycle` invokes it exactly when a port wins after a
  drain started, before publishing the served ports.
- Release invalidates only the current lease. Its orphan tick settles inert
  without consuming the lifecycle. If the first terminal was already claimed,
  release hands its exact exit callback or error origin to the served direct
  path; print remains one-shot.
- A direct terminal that wins before any drain marks terminal ownership.
  A subsequently opened drain parks until physical control or peer failure; it
  cannot perform a second natural exit or diagnostic.
- Flush, projection, diagnostic, and exit-control failure stay loud. The first
  terminal wins; stale drains and later terminal events cannot emit duplicate
  print, diagnostic, or control.

The export is deliberately eval-specific. This does not introduce generic
drain cancellation, `AbortSignal`, or a second process lifecycle.

## Consequences

- Served and run-to-completion eval share one lifecycle without orphan
  authority or an early server-result flush.
- Runtime-js gains one public coordination capability because the server
  decision lives in Workbench; all state and lease validation remain
  package-internal.
- Package race tests and physical Node differentials cover release before and
  after terminal claim, direct-terminal-before-drain, duplicate terminal, and
  loud failure.
