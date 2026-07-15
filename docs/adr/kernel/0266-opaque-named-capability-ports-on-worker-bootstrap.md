# ADR 0266: Opaque named capability ports on Worker bootstrap

Status: Accepted
Date: 2026-07

> TL;DR: Worker spawn gains one optional opaque name-to-`MessagePort` record;
> kernel validates, transfers, publishes, and closes the child endpoints, while
> every protocol and peer session stays in the consuming module.

## Context

Kernel Worker bootstrap owns one SAB and four fixed ports: stdout, stderr,
stdin, and fork IPC. A workspace owner now needs to pass a dedicated async port
for verified shadow-runtime assets. Those 13.3MiB reads do not fit the 1MiB SAB
sync-RPC and are not guest Node IPC or environment data.

An asset-specific kernel field would reverse the layer dependency. Ad-hoc
Worker init posts would duplicate transfer ordering and teardown. ADR-0043
previously rejected `WorkerSpawnSpec.extraPorts` because this is a public kernel
interface change; the decision therefore belongs here, not in the asset-store
item.

## Decision

- Add
  `capabilityPorts?: Readonly<Record<string, MessagePort>>` to public
  `SpawnWorkerSpec`. Required normalized snapshots travel in `WorkerSpawnSpec`
  and `KernelProcessSpec`. Absence becomes a frozen empty null-prototype record.
- Before Worker/channel allocation, snapshot own enumerable entries from a
  plain or null-prototype record. Names are exact non-empty strings: no trim,
  case fold, or protocol interpretation. Reject a non-record, non-`MessagePort`
  value, empty name, or one port identity under two names with synchronous
  `TypeError`; the message names `capabilityPorts` and the offending name(s).
  Validation failure adopts nothing and performs no spawn.
- After validation, kernel owns the supplied child endpoints. Caller mutation
  cannot change the snapshot. Each endpoint appears exactly once in the same
  init transfer list as stdio/IPC. A later Worker-constructor, dispatcher, or
  init-post failure terminates any created Worker, detaches the ring, closes all
  kernel-created and adopted ports exactly once, publishes no process record,
  then rethrows the original error.
- Worker bootstrap rebuilds the received record as a frozen null-prototype
  snapshot and publishes it in `KernelProcessSpec` before the pre-entry hook or
  entry import. `readKernelProcessSpec()` is the lookup seam. Kernel never
  starts a capability port, sends frames, or projects it into Node `process`,
  env, stdio, fork IPC, or a parent-side handle.
- SAB attach, process publication, pre-entry, entry, and drain failures share
  one exit-1/finalization path. When stderr is usable it receives the failure.
  Failed setup and clean run-to-completion close capability ports with stdio.
  Clean `serve:true` keeps them live; hard kill terminates the realm. Kernel
  does not invent a graceful protocol shutdown frame.
- The caller owns every peer endpoint and server session. It starts the peer
  before spawn and attaches exit/kill/spawn-failure cleanup before returning a
  child handle. Protocol deadlines remain required for abrupt peer death.

### Rejected alternatives

- `extraPorts` or per-consumer fields: either untyped transfer sprawl or a
  kernel dependency on higher-layer protocol names.
- SAB sync-RPC: size-capped and synchronous; wrong carrier for multi-megabyte
  async responses.
- Node IPC/env: changes guest-visible semantics and cannot carry ownership of a
  dedicated transferable endpoint.
- A second post after init: entry can run first and observe a missing
  capability; teardown splits across two protocols.

## Consequences

- One small generic interface hides transfer-list, publication-order, and
  rollback complexity. Capability protocols remain independently testable
  above kernel.
- Spawn becomes failure-atomic for existing stdio/dispatcher resources too;
  current synchronous init-post and child attach leaks are closed by the same
  implementation pass.
- The public spawn/process types grow irreversibly. A caller that supplies a
  valid record gives up its child endpoints even when a later spawn step fails.
- No automatic inheritance: every descendant spawn gets explicit fresh ports.
