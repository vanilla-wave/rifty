# ADR 0333: Descendant settlement barrier preserves recursive teardown ordering

Status: Accepted
Date: 2026-07-27

> TL;DR: fence admission, signal exact descendant routes child-first, then
> delay an ancestor's output cut until those routes settle after local close
> callbacks or prove peer death.

## Context

ADR-0326 gives one owner-root process tree and ADR-0332 gives each physical
Worker one exact output cut. Recursive termination must order them: cutting an
owner first can reject output admitted by a descendant's final close callback,
while deleting descendant records fabricates termination.

## Decision

Terminal admission sets the owner fence before cancelling reservations or
walking the tree. Teardown attempts every exact remote and forwarded route in
child-first order. Only successfully signalled routes join the descendant
barrier. A child publishes settlement after its local `close` callback and one
microtask checkpoint; settlement or authenticated peer death releases the
route. Only then does the physical owner's ADR-0332 output cut start.

Authenticated owner peer death bypasses an unresolved barrier and abandons any
unprovable output drain. A slow live peer remains pending: no timeout can prove
settlement. Terminal paths attempt all local retirement, abort, EOF/control
close, route release, and upstream relay work before surfacing the original
failure or an `AggregateError`.

The mechanism sweep covers same-realm, Worker, remote-record, and forwarded
routes. A remote record reuses its lifecycle `AbortController`; a
forwarding-only route has one co-located one-shot settlement
`AbortController` because it has no record. The process table and route map
remain the only ledger, and ADR-0332 remains the sole output authority. No
second barrier/route/output ledger, acknowledgement protocol, or timer ships.

## Fault and simplicity consequences

- `observable-order`: fence → child-first signal → child close checkpoint →
  route settlement → ancestor cut.
- `torn-state`: listener/upstream failure cannot skip remaining cleanup.
- `provenance-lie` / `unbounded-read`: exact settlement or peer death only;
  slow live peers remain pending.
- `sibling-drift`: all four carriers share that order without duplicate state.

Specifies ADR-0326's ancestor/descendant terminal ordering. ADR-0332 otherwise
stands.
