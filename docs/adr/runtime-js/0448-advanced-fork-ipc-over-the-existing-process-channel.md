# ADR 0448: Advanced fork IPC over the existing process channel

Status: Accepted
Date: 2026-09

> TL;DR: An advanced fork selects structured-clone payloads on ADR-0326's
> existing public MessagePort; default JSON, private control, and logical
> disconnect stay on their current owners.

## Context

Vitest 4.1.11 starts its default pool with `fork(...,
{serialization:'advanced'})`. Rifty rejects the option before allocating a
Worker. Node 24.16.0 preserves Date, Map, undefined array entries,
Uint8Array, BigInt and cycles in both directions; `send(undefined)` and
`send(function)` fail synchronously without closing the channel.

ADR-0326 chose one public JSON lane over the existing MessagePort and left
advanced serialization loud. The kernel's port already structured-clones each
frame; the parent and child runtime adapters impose JSON today. The decision
here adds a mode to that seam, not a channel, ledger, lock or ordering rule.

## Decision

Extend the exact program-launch IPC discriminator to `none | json | advanced`.
Only a fork with `serialization:'advanced'` selects the new mode. The parent
and child use the same mode for send and receive. JSON remains the default,
including its validation and observable coercions; plain spawn still has no
public IPC. Keep `rifty.node-entry/v4`: the producer and reader ship in one
bundle, while an older reader rejects `advanced` loudly before guest entry.

For advanced payloads, validate Node's top-level send errors, then use native
`structuredClone` before posting. Preserve ordinary cloneable data graphs
(Date, Map, Set, RegExp, Error, typed arrays, BigInt, cycles and plain data).
An uncloneable nested value throws synchronously and leaves the channel
usable. Node-specific Buffer identity cannot survive native structured clone
(`Buffer` becomes `Uint8Array`), so a Buffer anywhere in the reachable graph
throws `NotImplementedError('child_process.serialization.advanced.Buffer')`.
Plain-object accessors are also loud until their getter evaluation order
and Buffer provenance can be preserved; native Error.stack follows the
platform serializer. Unknown host objects are loud; Node
rejects SharedArrayBuffer even though native structured clone accepts it, so
that value keeps Node's synchronous clone error. None silently changes type.

Use ADR-0326's one physical public/control port, ordering, disconnect and
worker-death outcomes. Do not add per-message sequencing or retry. The
fault-test owner covers invalid send recovery, accepted-message order,
post-disconnect state, the JSON sibling, and the Buffer ceiling.

Rejected: implement Node's V8 wire format in JavaScript. Its Node-specific
type table and serializer protocol would become a second semantic authority
for a path whose accepted values the browser already clones; no claimed
Vitest value requires it. If later evidence does, that is a new decision.

## Consequences

- Vitest's forks pool can start and exchange standard structured-clone
  values without JSON loss; Node's default fork behavior remains JSON.
- Buffer, plain-object-accessor and other unsupported V8-only payloads stay named
  loud gaps in the public compat table, not silent type substitutions.
- ADR-0326's public/private lane separation and teardown remain authoritative.
