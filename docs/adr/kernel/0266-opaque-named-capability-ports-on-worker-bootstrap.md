# ADR 0266: Opaque named capability ports on Worker entries

Status: Accepted
Date: 2026-07

> TL;DR: a URL Worker entry may carry one optional opaque
> name-to-`MessagePort` record. Kernel validates, transfers, publishes, and
> closes the child endpoints without adding them to process identity or learning
> any consuming protocol.

## Context

Kernel Worker bootstrap owns one SAB and four fixed ports: stdout, stderr,
stdin, and fork IPC. A workspace owner also needs dedicated async capabilities;
the first consumer serves a verified 13,918,738-byte runtime asset that does not
fit the 1 MiB sync-RPC ring and is not guest Node IPC or environment data.

ADR-0267 now attaches opaque bootstrap metadata to a URL
`WorkerEntryDescriptor` and explicitly rejects metadata on
`KernelProcessSpec`. Capability endpoints have the same entry lifetime but need
their own generic transferable seam: placing ports inside the higher-runtime
bootstrap envelope would couple two independent protocols, while a
process-spec field would repeat the rejected option-bag design.

## Decision

- The URL variant of `WorkerEntryDescriptor` gains
  `capabilityPorts?: Readonly<Record<string, MessagePort>>` beside
  `bootstrap`. Source entries cannot carry capabilities. `SpawnWorkerSpec`
  already owns the entry; `WorkerSpawnSpec` transports its normalized snapshot.
  `KernelProcessSpec` remains unchanged.
- Before SAB/channel/Worker allocation, snapshot a plain or null-prototype
  record from own enumerable string data properties. Names are exact non-empty
  strings: no trim, case fold, or protocol interpretation. Reject accessors,
  enumerable symbols, non-`MessagePort` values, or one port identity under
  multiple names with synchronous `TypeError` naming `capabilityPorts` and the
  offending key. Validation failure adopts nothing and performs no spawn.
- After validation kernel owns the supplied child endpoints. Caller mutation
  cannot change the normalized entry. Each endpoint appears exactly once in the
  existing init transfer list with stdout, stderr, stdin, and IPC.
- Parent spawn is one resource transaction. Any later SAB/fixed-channel/Worker
  construction, dispatcher attach, init post, or lifecycle-listener failure
  terminates a created Worker, detaches an attached ring, closes every created
  and adopted port exactly once, publishes no process record, and rethrows the
  original error. The existing synchronous init-post rollback remains a
  regression guarantee and expands to the adopted ports.
- Child bootstrap rebuilds a frozen null-prototype capability snapshot and
  publishes it through a separate non-enumerable entry-scoped global.
  `readKernelEntryCapabilityPorts()` returns that snapshot; absence and source
  entries return one frozen empty null-prototype record. Publication occurs with
  ADR-0267 entry bootstrap before the pre-entry hook or entry import.
- Kernel never starts a capability port, sends frames, interprets names, or
  projects the record into Node `process`, env, stdio, fork IPC,
  `KernelProcessSpec`, `WorkerStdioPorts`, or a parent-side process handle.
- SAB attach, sync/process/bootstrap/capability publication, pre-entry, entry,
  and drain share one child failure/finalization path. When stderr is usable it
  receives the failure. Failed setup and run-to-completion close capability
  ports with stdio. Clean `serve:true` keeps them live; hard termination closes
  the realm. Kernel invents no graceful protocol-shutdown frame.
- The caller owns every peer endpoint and server session. It starts the peer
  before spawn and attaches spawn-failure/exit/kill cleanup before exposing a
  child handle. Protocol deadlines remain required for abrupt peer death.

### Rejected alternatives

- `extraPorts` or consumer-specific fields: unbounded transfer sprawl or a
  kernel dependency on higher-layer protocols.
- `KernelProcessSpec`: capabilities describe one entry, not Node/WASI process
  identity; ADR-0267 already rejected this option bag.
- ADR-0267 `bootstrap.payload`: combines higher-runtime configuration with
  independently consumable endpoints and forces unrelated protocol versions to
  move together.
- SAB sync-RPC: synchronous and size-capped; wrong carrier for multi-megabyte
  responses.
- Node IPC/env: changes guest-visible semantics and cannot carry ownership of a
  dedicated transferable endpoint.
- A second post after init: entry can run first and teardown splits across two
  protocols.

## Consequences

- One small entry-scoped interface hides transfer-list, publication-order, and
  rollback complexity. Capability protocols remain independently testable above
  kernel.
- Process identity stays deep and stable; higher runtimes read bootstrap and
  capabilities through separate typed accessors.
- The public URL-entry descriptor grows irreversibly. Supplying a valid record
  gives kernel ownership of its child endpoints even when a later spawn step
  fails.
- No automatic inheritance: every descendant entry receives explicit fresh
  endpoints.
