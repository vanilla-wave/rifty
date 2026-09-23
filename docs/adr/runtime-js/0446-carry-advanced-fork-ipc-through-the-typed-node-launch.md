# ADR 0446: Carry advanced fork IPC through the typed Node launch

Status: Proposed
Date: 2026-09

> TL;DR: Select advanced fork serialization through the existing typed launch;
> preserve native graph and failure semantics over the existing public lane.

## Context

Vitest's default pool requests advanced fork IPC. ADR-0326 deliberately rejects
it, and both parent and child program paths normalize public messages as JSON.
Native Node v24.16.0 preserves rich/cyclic graphs, including Buffer identity,
and rejects bad messages synchronously without disconnecting. Raw structured
clone loses Buffer identity and throws a different clone-error class.
Oracle and RED: `docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md`.

## Decision

- Atomically migrate `rifty.node-entry/v4` to `v5`, adding `advanced` to the
  program launch's public IPC discriminator. All producers/readers migrate;
  old protocols fail. No env key or permissive compatibility reader
  (ADR-0267/0416).
- Runtime-js owns one mode-selected serialization boundary for both public
  senders/receivers. Default JSON remains JSON. Advanced preserves native
  rich-value brands, graph identity and send-time snapshots; getter evaluation
  happens once. A collision-free runtime envelope may carry Buffer metadata
  on the existing public frame; guest objects cannot impersonate metadata.
- Validate and clone before dispatch and before transport-failure handling.
  Invalid top-level types keep Node error codes; nested uncloneables throw
  Node-shaped clone errors; getter exceptions retain identity. A caller value
  failure sends nothing and does not disconnect either lane.
- Public IPC enablement owns listener keepalive independently of serializer
  mode. Keep the existing MessagePort, ordering, process/terminal owners and
  private-control lifetime. Public disconnect still permits private kill.
- Partially supersedes ADR-0326's advanced ceiling and JSON-only program
  discriminator, and ADR-0416's active node-entry v4 version. Other clauses
  remain, including send handles/callbacks/options and channel ref/unref gaps.
  Worker-thread structured clone remains its distinct launch role.

## Consequences

- Vitest forks carry native values without JSON loss or an additional channel.
- Matching Worker assets deploy together; no v4 fallback. Physical differential
  rich/fault cases and owner parser tests prove both boundaries.
- Buffer preservation requires a codec beyond raw structured clone; no new
  queue, correlation ledger, delivery acknowledgement or transport retry.
