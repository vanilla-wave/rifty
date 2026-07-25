# ADR 0321: Keep shadow asset port correlation package local

Status: Accepted
Date: 2026-07

> TL;DR: the shadow asset `MessagePort` keeps its strict ready/read/cancel
> correlation engine inside npm-client because no layer-correct shared
> primitive exists; consolidation remains an explicit cross-package decision.

## Context

The mechanism sweep in
`docs/backlog/playground/correlated-broadcast-bridge-helper.md` records eight
live request-id + pending-map + deadline + teardown engines. The shadow asset
port is the ninth. Class-kill requires consolidation or a decision explaining
why another owner is real.

npm-client is below Workbench and Playground, so it cannot import their bridge
helpers. The lower net/runtime-js engines own protocol-specific streaming or
evaluation semantics and expose no generic, layer-correct correlation
primitive. Extracting one requires a lower-layer contract and migration sweep,
not an npm-client-to-higher-layer dependency.

## Decision

- Keep this correlation engine package-local. The server first sends the
  strict `{type: 'ready', plan, bindings}` descriptor; the client validates it
  before reads. Each read gets one safe monotonic id and one deadline, then
  settles from one correlated `result`/`error` or its deadline. Deadline
  removes the waiter and sends best-effort `{type: 'cancel', id}`; cancel drops
  the server's active correlation so a late result cannot settle it.
- Malformed protocol, post failure, peer death, and disposal terminalize the
  port, clear deadlines, and settle every waiter once. MessagePort ordering
  excludes live duplicate/reorder/replay, so no replay journal, epoch, or
  completed-id ledger is added.
- The consolidation draft remains the owner for a future shared
  correlate/settle-once/deadline/teardown primitive. Such extraction must keep
  wire shapes and protocol-specific admission unchanged and supersede this
  package-local decision.

## Contract evidence

[The port contract](../../../packages/npm-client/src/internal/shadow/port.contract.test.ts)
pins ready-first decoding, correlation, cancellation, deadline, peer death,
post failure, duplicate-active rejection, and settle-once teardown.

## Consequences

- npm-client keeps a legal import graph and an independently testable
  ready/read/cancel lifecycle.
- The ninth implementation is explicit design debt, not an accidental shared
  mechanism claim.
- A future consolidation is cross-package work with shared lifecycle tests,
  not a point refactor of this port.
