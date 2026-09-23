# ADR 0452: Reference locally owned native MessagePorts without counting infrastructure listeners

Status: Accepted
Date: 2026-09

Chosen carrier for Contract+RED: real same-realm native pairs, manual Node refs,
intercepted local closure; raw kernel channels retain their existing behavior.
Extends ADR-0152's named handle set for the Vitest I4 NAPI waiting counter.

## Evidence

`docs/backlog/runtime-js/reference/message-port-ref-keepalive-evidence.md`:
Node v24.16.0 oracle, Chromium 148 page/Worker close probe, fresh-port RED.
`@emnapi/runtime@1.10.0` chooses global MessageChannel before worker_threads,
creates an otherwise idle port, and conditionally refs/unrefs it for pending
NAPI work. Browser ports lack both methods; pending work silently loses its ref.

## Candidates

- Prototype-only ref bookkeeping: smallest interface, rejected. Chromium emits
  no observed native close notification; peer close would leave a false live ref.
- Replace ports / cross-realm closure protocol: rejected. Changes port identity
  and adds a transport/lifecycle layer the forcing local counter does not need.
- Register native local pairs at public construction, mediate manual refs and
  actual local close, refuse ownership-losing transfer: selected. Native ports
  carry user bytes; no fake channel, new package dependency or emnapi patch.

## Ownership and public seam

Kernel shared-globals pins the primordial MessageChannel constructor once,
BEFORE the public shim installs. A typed `getKernelHostMessageChannel()` export
through kernel/index.ts returns that pinned value; it never guesses from the
current global. Both raw kernel channel allocation and the runtime shim consume
this one owner. A second bundled kernel copy reads the realm-shared record,
never recaptures the already wrapped global. This new cross-package public seam
is covered by the dual-module browser fault case (DEC-1).

Runtime-js installs at Node realm preparation (`installWorkerRealmCompat`),
before package evaluation; public global and node:worker_threads constructors
remain aliases. Runtime ref/pair/installation state is realm-shared as well.
Repeated installation cannot double-wrap or double-count. The public constructor
returns real native ports; prototype/instance identity and data transport remain
native. Kernel uses the original constructor, so private transferred ports are
not accidentally classified as owned guest pairs.

## Lifetime and limits

Only explicit manual refs add this handle class to existing event-loop-keepalive.
Default channels and infrastructure listeners do not acquire refs by installation.
No full EventEmitter MessagePort API or automatic listener-driven keepalive is
claimed here. Ref/unref/hasRef and their manual transitions are proven against
Node; this is a bounded capability, not all MessagePort compatibility.

Owned pair closure requires an observed native close call. It schedules Node's
close notification after current microtasks/check turn and earlier accepted
queued message delivery, then releases both endpoints' refs. Own/peer close
remain pending through the immediate checkpoint; ref after the close event
cannot revive a closed endpoint. No fixed elapsed-time guess and no fabricated
peer-death signal. Browser-native absence of close events is explicit evidence,
not permission to pretend remote closure was observed.

Transfer of an owned endpoint throws
`NotImplementedError('MessagePort.transfer.managed')` BEFORE detachment, including
ArrayBuffer companions. Native postMessage and structuredClone are covered;
implementation must cover every installed native transfer entry it exposes,
without inspecting/mutating user payloads. Raw kernel ports and ordinary
ArrayBuffer transfers retain native behavior. Cross-realm/manual-ref ownership,
implicit peer death and GC-driven closure are outside this local-pair promise.

## Status

No production implementation at preparation. Contract+RED must pass before
installing the public shim, shared primordial seam or lifecycle bookkeeping.
