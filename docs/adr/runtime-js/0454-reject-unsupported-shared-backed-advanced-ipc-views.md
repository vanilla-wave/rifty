# ADR 0454: Reject unsupported shared-backed advanced IPC views

Status: Accepted
Date: 2026-09

> TL;DR: Advanced fork IPC rejects SAB-backed views by name until their Node
> V8 wire form can be reproduced; the existing validator reads Map/Set
> internal entries, never a user-supplied iterator.

## Context

ADR-0448 admits typed arrays using native `structuredClone`. Node v24.16.0
physical fork copies SAB-backed Uint8Array/DataView/Uint16Array into ordinary
ArrayBuffers. Native structured clone leaves the backing shared. Node's
observable buffer lengths, offsets and aliasing also differ from a direct
ArrayBuffer copy and vary with the wire message shape (two Node probes of
three views on one SAB(8): 42/42/8192 bytes, offsets 20/27/0, no alias;
55/55/55 bytes, offsets 33/40/46, aliased). Sending a shared view as
supported would lie about memory ownership.

The same preflight validator iterated Map/Set through `for...of`. An own
`Symbol.iterator` can hide a Buffer or SAB entry, so the clone silently loses
Buffer brand or admits raw SAB. Node reads internal Map/Set entries and never
calls that user iterator. Evidence and RED: `docs/backlog/runtime-js/reference/advanced-ipc-clone-fidelity-evidence.md`.

## Decision

`ArrayBuffer`-backed views remain supported. A SAB-backed view, including
DataView, throws `NotImplementedError('child_process.serialization.advanced.shared-view')`
before posting. Raw SAB still gets Node's clone error. Read view backing via
captured intrinsic getters, so an own `buffer` property cannot hide sharing.
Validate Map/Set entries with captured intrinsic `forEach`, covering both
siblings at the one serialization boundary. Keep the existing channel,
default JSON, error priority and Worker lifecycle.

Rejected: native structured-clone passthrough retains shared backing.
Rejected: copying to a new ArrayBuffer loses Node's observable backing
length/offset/alias semantics; no exact V8 wire model is proven for browser
Workers. A later implementation needs a differential contract, not a local
copy heuristic.

## Consequences

- No silent shared-memory or hidden Buffer-brand downgrade on advanced IPC.
- SAB-backed views remain a compat ❌; ordinary ArrayBuffer-backed typed
  arrays and DataView keep their existing parity claim.
- ADR-0448's broad typed-array wording is narrowed to ArrayBuffer-backed
  views; its channel and standard clone decisions remain active.
