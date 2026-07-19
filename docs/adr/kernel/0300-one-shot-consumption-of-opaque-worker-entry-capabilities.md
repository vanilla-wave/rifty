# ADR 0300: One-shot consumption of opaque Worker entry capabilities

Status: Accepted
Date: 2026-07
Supersedes: ADR-0266

> TL;DR: a URL Worker entry may carry one opaque name-to-`MessagePort`
> record. Kernel transfers and publishes it for privileged bootstrap, which
> atomically consumes the record before importing less-privileged guest code.

## Context

Kernel Worker bootstrap owns one SAB and four fixed ports: stdout, stderr,
stdin, and fork IPC. Workspace owners also need dedicated async capabilities;
the first consumer serves a verified 13,918,738-byte runtime asset that does not
fit the 1 MiB sync-RPC ring and is neither guest Node IPC nor environment data.

ADR-0267 attaches opaque bootstrap metadata to a URL entry and rejects it on
`KernelProcessSpec`. Capability endpoints have the same entry lifetime but need
an independent transferable seam. ADR-0266 introduced that seam and published
the capability map on a non-enumerable global before pre-entry and entry import.

Real guest proof found that non-enumerability is not isolation:
`Object.getOwnPropertyNames(globalThis)` exposes the key and guest code that
knows the exported key can recover every port. Kernel cannot delete the record
after pre-entry because higher-runtime URL bootstraps consume it later, before
their own VFS guest import. Changing the existing repeated-read lifetime or
using `publish(null)` as an implicit clear would silently overturn a public
inter-package contract.

## Decision

- The URL variant of `WorkerEntryDescriptor` retains
  `capabilityPorts?: Readonly<Record<string, MessagePort>>` beside `bootstrap`.
  Source entries cannot carry capabilities. `SpawnWorkerSpec` owns the entry;
  `WorkerSpawnSpec` transports its normalized snapshot. `KernelProcessSpec`
  remains unchanged.
- Before any resource allocation, kernel snapshots a plain or null-prototype
  record from own enumerable string data properties. Names are exact non-empty
  strings. Accessors, enumerable symbols, non-`MessagePort` values, and one port
  under multiple names synchronously throw a `TypeError` naming the offending
  `capabilityPorts` key. Validation failure adopts nothing.
- After validation kernel owns the supplied child endpoints. Caller mutation
  cannot change the normalized entry. Each endpoint appears exactly once in the
  init transfer list after stdout, stderr, stdin, and fork IPC.
- Parent spawn remains one resource transaction. A later allocation, attach,
  init-post, or listener failure terminates a created Worker, detaches an
  attached ring, closes every created and adopted port exactly once, publishes
  no process record, and rethrows the original failure.
- Child bootstrap publishes a frozen null-prototype capability snapshot through
  a separate non-enumerable configurable entry global before the pre-entry hook
  or URL import. Absence and an empty record are canonical absence: no own global
  property. `readKernelEntryCapabilityPorts()` remains a non-consuming peek and
  returns one frozen empty null-prototype record when absent.
- `consumeKernelEntryCapabilityPorts()` validates the published data property,
  removes the own global property, then returns a frozen null-prototype snapshot.
  Deletion must succeed before authority is returned; corruption or deletion
  failure throws loudly and leaves teardown to the entry lifecycle. Repeated
  consume and reads after consume return the canonical empty record. Removing
  the global does not close or invalidate its ports.
- A higher-runtime URL bootstrap that will import less-privileged guest code
  MUST consume once before that import. It may bind known ports in lexical scope
  or close unused ports. Unknown names are a higher-runtime protocol mismatch,
  not kernel knowledge. Kernel must not auto-delete after pre-entry because the
  consuming bootstrap has not necessarily run yet.
- Kernel never starts a capability port, sends frames, interprets names, or
  projects the record into Node `process`, env, stdio, fork IPC,
  `KernelProcessSpec`, `WorkerStdioPorts`, or a parent process handle.
- SAB attach, shared-global publication, pre-entry, URL import, and drain share
  one child failure/finalization path. Failed setup and run-to-completion close
  capability ports with stdio. Clean `serve:true` keeps ports live until the
  consuming protocol disposes them or hard termination closes the realm.
  Kernel invents no graceful protocol-shutdown frame.
- The caller owns every peer endpoint and server session. It starts peers before
  spawn and attaches spawn-failure/exit/kill cleanup before exposing a child
  handle. Protocol deadlines remain required for abrupt peer death. Descendants
  never inherit capabilities automatically; each receives fresh endpoints.

### Rejected alternatives

- Keep the non-enumerable global for the full entry lifetime: ordinary guest
  reflection and a known exported key recover authority.
- Make `readKernelEntryCapabilityPorts()` destructive: repeated-read behavior
  becomes surprising and privileged observation accidentally consumes state.
- Clear with `read()` plus `publish(null)` or direct `delete`: lifecycle knowledge
  leaks into higher layers and the handoff is not one atomic public operation.
- Delete immediately after kernel pre-entry: higher-runtime bootstraps have not
  yet adopted their ports; moving protocol adoption into kernel reverses the
  layering of ADR-0039.
- Put ports in ADR-0267 bootstrap metadata, SAB sync-RPC, Node IPC, env, or
  `KernelProcessSpec`: these couple independent protocols, exceed the sync ring,
  or change guest process identity.
- Send a second post after init: the URL entry can run first and teardown splits
  across two protocols.

## Consequences

- Kernel retains one generic capability carrier and no knowledge of Workbench,
  shadow assets, or esbuild.
- Privileged bootstrap has an explicit one-shot handoff; guest code receives no
  ambient path to the capability while the adopted port remains usable.
- The public kernel API and observable empty/publication lifetime change. Every
  guest-bearing URL bootstrap must prove consume-before-import across its finite
  sibling set.
