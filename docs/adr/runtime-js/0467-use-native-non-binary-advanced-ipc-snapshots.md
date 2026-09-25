# ADR 0467: Use native non-binary advanced IPC snapshots

Status: Accepted
Date: 2026-09-25

## Context

User explicitly amended vitest-run-in-browser: Vitest sufficient; binary IPC
must fail loudly. The144-message native Vitest census contains no binary values.
User also permits the former opaque-brand ceiling if needed; it is unnecessary
with native cloning. Both pools and all primary acceptance remain required.

Independent decision: binary_ipc_scope_decision. Native clone of actual QuickJS
plain object/array mirrors fails because they are host Proxy carriers; Map
backings clone. Do not widen VM to avoid that explicit carrier limitation.
The unchanged exact Vitest fixture passed10runs on fresh Chromium5502 using the
native candidate (47.1s;53.9s total).

## Decision

- Both advanced senders take one captured native structuredClone snapshot.
  Preserve existing top-level Node validation and every thrown exception by
  identity. Intrinsic native failures expose platform DataCloneError, not
  Node v8 Error. Do not mutate guest constructor or register promise reactions.
- Inspect only the clone for ArrayBuffer/SharedArrayBuffer/views (Buffer clones
  as Uint8Array), including records/arrays, Map keys/values, Set and Error.cause.
  Cycles terminate. Any binary value in the serialized graph throws
  NotImplementedError('child_process.serialization.advanced.binary') before
  dispatch. Ignored symbol/non-enumerable guest properties remain ignored.
- Keep the current private frame shape with empty buffers metadata; receivers
  refuse binary graphs/nonempty metadata. JSON, private control, channel health,
  launch protocol and event-loop owners are unchanged.
- Remove the custom Buffer graph copier, restoration, shared-view snapshot,
  Promise constructor probe, global Proxy/revocable/toString facades and their
  provenance registry. Native clone owns host Proxy/intrinsic rejection.
- Remove the capture-sealing API and runtime-bootstrap role introduced solely
  for that registry. Preserve other startup/fatal-error fixes and real VM
  Map/Set/Error backings and builtinModules snapshots.
- QuickJS Proxy-backed mirror values can fail native cloning even when their
  Node VM equivalents are cloneable. State this boundary explicitly; no extra
  full VM-to-IPC compatibility promise. Exact Vitest acceptance is mandatory.

## Supersession

Partially supersedes ADR-0446: its binary preservation/custom Buffer metadata
promise is replaced above; typed launch, validation, public/private separation
and single codec ownership remain. Supersedes ADR-0453 provenance ownership and
ADR-0465 capture-phase machinery. Their independent builtinModules/VM repairs
remain; no blanket rollback of verified behavior. Original rationale/evidence
remain available in git history and reference documents.

## Alternatives / proof

Native clone + binary refusal is the smallest interface under the user's
amendment: one native snapshot, one read of each serialized getter, native
frozen/Promise/Proxy behavior. Custom nonbinary copier plus approved opaque-brand
ceiling remains a rejected fallback: unnecessary mutation/provenance machinery
and extra refusals, while native Vitest already passes.

Binary unit census37RED→37GREEN; combined codec73PASS. Both-public-sender binary
refusal, nonbinary physical parity, final native Vitest, production/packed and
whole delivery review remain required after mechanism removal. Test migrations
are explicit consequences of the user amendment, not fixes to make unchanged
criteria pass. No all-green delivery claimed by this ADR alone.

## Error identity correction

Independent decision/probe: a getter can throw a DOMException obtained from a
previous native clone failure. Name/brand/message/stack cannot establish where
it originated in this call. Converting DataCloneError into Error corrupts that
accepted getter identity. Preserve all native exceptions; document the platform
class difference. This re-cuts ADR-0446 error-shape parity under the user's
native-clone/Vitest-only route, without changing the primary scenario or binary
ceiling. No reflection pre-walk or error-origin tracking owner added.
