# ADR 0480: Refuse advanced IPC view constructor accessors

Status: Accepted
Date: 2026-09

## Context

ADR-0448 clones bytes before reading a view's `constructor`. Node v24.16.0
reads it first: an own/inherited getter changing `[1]` to `[2]` sends `[2]`,
while rifty sent `[1]`. This is successful-send corruption, not the ADR's
“error paths only” residual. Repro and differential carrier:
`tools/node-parity-runner/cases/child_process/public-ipc-advanced-constructor.fault.test.ts`.

## Decision

Partially supersede ADR-0448 Decision 3's constructor read and its residual
classification. Resolve the constructor through property descriptors; an own
or inherited accessor throws
`NotImplementedError('child_process.serialization.advanced.constructor-accessor')`.
No accessor invocation, no dispatch; a subsequent ordinary send still works.
Data constructors, Buffer branding and ordinary typed-array subclasses stay.
The shared codec covers parent/child and Worker/same-realm IPC.

Keep native clone first. Other graph getters therefore retain clone order and
may run before refusal; this is not a preflight with zero guest side effects.
Proxy prototypes remain outside this accessor ceiling: descriptor traps can
execute guest code. Explicit compat warning and finding
`docs/backlog/runtime-js/advanced-ipc-proxy-prototype.md`; no proxy parity claim.

## Alternatives

- Pre-read constructors before clone: rejected; moves them before earlier graph
  getters and cannot reproduce V8 traversal order.
- Hand-written snapshot serializer: ADR-0448's rejected full semantic port;
  unnecessary for a named refusal permitted by the repair scope.
- Refuse every custom prototype: rejected; loses proven ordinary subclasses.
- Descriptor refusal: selected; preserves the existing ordinary-data baseline.

Independent DEC-2 decision review (2026-09-29): justified-with-fixes; include
inherited accessors, preserve clone order, distinguish Proxy prototype residual.

## Consequences

A previously successful but wrong send becomes an explicit unsupported case.
Chromium and physical-worker differential tests carry the ceiling and its Node
baseline; no claim of full advanced serialization parity.
