# ADR 0046: `PreviewOwnerBinding` — one seam for window and worker preview owners

Status: Accepted (promoted from Q-2026-05-27-002)
Date: 2026-05

## Context

The Service Worker preview interceptor (`@riftydev/service-worker`) routes
`/preview/<port>/*` fetches to whatever realm owns the in-process
handler for that port. Through M10 that realm is always the playground
window: `FirstWindowOwnerResolver` picks the owning `Client` and a
window-shaped `ReadyClientsRegistry` (living inside `preview-bridge.ts`)
gates each fetch on the `rifty:preview:ready` handshake. Both halves
assume `event.source` is a window `Client`.

Q-2026-05-27-002 deferred extracting a shared binding shape until a
second consumer existed, on the standing rule in this codebase that a
one-consumer interface almost always needs revision when the second
arrives. A-023 (SW→Worker direct routing, on top of ADR-0043's
Vite-in-Worker realm) is that second consumer: the owner becomes a
kernel-spawned `Client` of `type === 'worker'` that hosts a preview
port. Workers have a materially different lifecycle from windows —
there is **no `pagehide` and no `controllerchange`** — so the
window-only readiness model cannot simply absorb them. With both
consumers now concrete, the binding can be designed from both shapes at
once and the open question closed.

The 2026-05-27 architecture review (item #4) attached a sibling
deferral to the same A-023 wave: `bridgeCrossRealmPreview` is currently
buffered-only (`packages/net/src/cross-realm/preview-port.ts`). That is
a **separate** cross-realm wire-frame concern — it is explicitly *not*
in scope here. This ADR does not touch the cross-realm frame format,
does not introduce streaming/chunked frames, and does not bump
`SW_FRAME_VERSION`. The streaming split remains deferred to its own
future ADR.

## Options considered

- **A — define `PreviewOwnerBinding` now, designed from both consumers
  (chosen).** A single interface `{ resolveOwner, subscribeReadiness }`
  that the interceptor sits on top of, with two implementations —
  `FirstWindowOwnerBinding` (wrapping the historical resolver +
  registry pair) and `WorkerOwnerBinding` (port-keyed routing with a
  worker-aware lifecycle). The interceptor stays binding-agnostic; the
  window vs worker choice is a runtime decision the host makes when
  installing the interceptor.
- **B — keep the window path on the bare `PreviewOwnerResolver` +
  registry and add a parallel worker path.** Rejected: it forks the
  route-preview pipeline into two near-duplicate flows, and the
  readiness/teardown asymmetry (windows post goodbye on `pagehide`;
  workers may die silently) leaks into the interceptor instead of being
  isolated behind one seam.
- **C — fold worker support into the existing window registry by
  special-casing `Client.type`.** Rejected: the window registry's
  contract (`'ready' | 'timeout' | 'mismatch'`, goodbye-on-`pagehide`)
  has no place to express "owner terminated without goodbye"; bolting a
  fourth state onto a window-shaped object muddies both consumers.

## Decision

Adopt option **A**. The binding contract lives in
`packages/service-worker/src/preview-owner-binding.ts` and is designed
from both consumers simultaneously.

### The `PreviewOwnerBinding` contract

```ts
interface PreviewOwnerBinding {
  resolveOwner(
    scope: ServiceWorkerGlobalScope,
    request: Request,
    clientId: string | null,
    port: number,
  ): Promise<Client | null>;
  subscribeReadiness(scope: ServiceWorkerGlobalScope): ReadinessSubscription;
}
```

- **`resolveOwner`** returns the owning `Client` for a fetch, or `null`
  when none can be located (the route-preview path maps `null` to HTTP
  503). The `port` is carried because the worker binding routes by port
  — multiple Workers may host different preview ports — while the
  window binding ignores it (a window owns every preview port the page
  registers via `setupPreviewBridge`). The window binding also forwards
  the historical `clientId`-then-first-window fallback verbatim
  (ADR-0031).
- **`subscribeReadiness`** installs the binding's message listener on
  the SW scope and returns a `ReadinessSubscription` — a live
  `ReadinessSignal` the route-preview pipeline gates on, plus a
  `teardown()` that removes the binding-installed listeners. Each
  `createPreviewInterceptor` call owns one subscription, so multiple
  bindings in one process (tests, future per-realm bindings) never
  share mutable readiness state.

`ReadinessSignal.waitForReady` resolves with a `ReadinessOutcome` and
**never rejects**:

```ts
type ReadinessOutcome = 'ready' | 'timeout' | 'mismatch' | 'gone';
```

`'ready'`, `'timeout'`, and `'mismatch'` carry their pre-existing
window meanings. **`'gone'` is new** — see below.

### The `'gone'` outcome and the no-`pagehide` worker trap

This is the lifecycle hazard Q-2026-05-27-002 flagged. A window owner
always gets a chance to post `rifty:preview:goodbye` on `pagehide` /
teardown, so the window registry can drop it from the ready set
cleanly. A **Worker has no document and therefore no `pagehide` and no
`controllerchange`**: a Worker that crashes or is terminated by the
kernel may never send goodbye. Without handling this, an in-flight
`waitForReady` for a dead Worker would hang until the full timeout, and
`resolveOwner` would hand back a stale `Client` handle.

`WorkerOwnerBinding` closes the trap two ways:

1. **Goodbye when possible.** On orderly termination the Worker posts
   `rifty:preview:goodbye` carrying the same `ports`, so the binding
   drops exactly those port→owner mappings and resolves any pending
   waiters with `'gone'`.
2. **Lazy revalidation at fetch time.** `resolveOwner` re-checks
   `scope.clients.get(workerId)`. If the lookup returns `undefined`
   (the Worker died without goodbye), the binding drops the stale
   mapping, resolves pending waiters with `'gone'`, and returns `null`.

`route-preview.ts` translates `'gone'` into a distinct 503
(`preview owner <id> departed before handshake`) so the failure is
diagnosable and not conflated with a timeout. The window binding never
emits `'gone'` — a window departure is a goodbye, which the legacy
registry already surfaces as `'timeout'` for backward compatibility;
the window binding preserves that semantics byte-for-byte.

### Port-keyed routing (worker binding only)

`WorkerOwnerBinding` maintains a `port → ownerId` map plus the inverse
`ownerId → Set<port>`, both built from each Worker's ready frame.
Routing a `/preview/<port>/*` fetch is a port lookup, not a client-id
lookup (a Worker-served preview fetch carries no DOM `clientId`).
Goodbye and silent-death both drop a Worker's port mappings precisely,
and a port mapping is only dropped if it still points at the departing
owner — so a fresh Worker that has already claimed the port keeps its
mapping (handover is clean). Different ports route to different Workers.

### Why the additive `ports` field needs no `SW_FRAME_VERSION` bump

The worker readiness frame extends the existing `rifty:preview:ready`
shape with one **additive optional** field:

```ts
{ type: 'rifty:preview:ready', frameVersion: '1', routingVersion: '1',
  ports?: number[] }   // default []
```

ADR-0031 established that every SW↔peer wire frame carries version
fields validated at decode time, and that **additive optional fields
with a documented default do NOT trigger a SemVer-major bump** — the
receiver treats `undefined` as the default. ADR-0040 restated that rule
for the frame side when it split versioning into `SW_FRAME_VERSION`
(wire-frame data shapes) and `SW_ROUTING_VERSION` (addressing +
owner-fallback rules). The `ports` field is structurally compatible
with the window-side ready frame: a window omits it, a worker supplies
it, and a frame missing `ports` is treated as `[]` (the worker binding
records readiness but claims no port — it cannot accidentally claim an
implicit port like 0). Therefore **`SW_FRAME_VERSION` stays `'1'`** and
`SW_ROUTING_VERSION` stays `'1'`. The binding contract itself (owner
fallback semantics) is conceptually part of `SW_ROUTING_VERSION`;
nothing in the addressing scheme or fallback order changed, so neither
constant moves.

### Wiring

`createPreviewInterceptor(scope, hooks)` builds a `PreviewOwnerBinding`
(default `FirstWindowOwnerBinding`, so M10 behaviour is preserved
byte-for-byte), calls `subscribeReadiness(scope)`, and threads both the
returned `ReadinessSignal` and the binding into `routePreview`.
`routePreview` is the single seam both bindings flow through: it asks
`binding.resolveOwner`, gates on the signal, and forwards each fetch
over a fresh `MessageChannel`. The `WorkerOwnerBinding` is selectable
via `hooks.binding` and exported from `@riftydev/service-worker`; the
`installPreviewInterceptor` default does **not** change because the
page is still the SW's counterpart for the legacy preview surface
(ADR-0043) — A-023 hosts swap in `WorkerOwnerBinding` per context.

A back-compat `hooks.resolver` hook remains (equivalent to
`binding: new FirstWindowOwnerBinding({ resolver })`) so the existing
`owner-resolver.test.ts` consumers compile unchanged; `binding` wins
when both are supplied.

### Microtask-timing invariant

Both `FirstWindowOwnerBinding.resolveOwner` and its `waitForReady`
return their inner promise **directly** (the methods are not declared
`async`). Wrapping the inner resolver/registry promise in an `async`
method would insert an extra await-unwrap microtask turn between a
ready frame resolving a waiter and `routePreview` resuming to dispatch.
The SW handshake tests gate dispatch on a fixed number of microtask
turns, so the binding must preserve the single-unwrap timing of the
pre-ADR-0046 path where `route-preview` awaited the resolver/registry
directly.

## Consequences

- New public surface of `@riftydev/service-worker`: `PreviewOwnerBinding`,
  `ReadinessSignal`, `ReadinessSubscription`, `ReadinessOutcome`,
  `FirstWindowOwnerBinding` (+`FirstWindowOwnerBindingOptions`),
  `WorkerOwnerBinding` (+`WorkerOwnerBindingOptions`,
  `WorkerOwnerBindingLogger`). Additive — the legacy
  `FirstWindowOwnerResolver` / `PreviewOwnerResolver` exports stay for
  back-compat.
- The route-preview pipeline is now genuinely binding-agnostic: window
  and worker owners share one flow rather than forking it.
- `ReadinessOutcome` gains `'gone'`; `route-preview.ts` returns a
  distinct 503 for it. Existing window-only outcomes are unchanged.
- The worker binding adds per-instance `port → ownerId` state behind a
  `WeakMap<scope, state>`, so multiple interceptors in one process do
  not bleed routing state.
- A dual-strategy parity test
  (`tests/preview-owner-binding-parity.test.ts`) exercises the same
  scenario set against both bindings, so a regression that touches only
  one binding shows up as a one-sided failure; worker-specific
  lifecycle traps (silent death, port handover, multi-port routing,
  ready-without-ports) have dedicated cases.
- Negative: the window binding still cannot distinguish a genuine
  goodbye from a timeout (it surfaces both as `'timeout'`), so `'gone'`
  is a worker-only signal today. Promoting the window goodbye to
  `'gone'` would change an observable window outcome and is left for a
  future ADR if a consumer needs it.
- Out of scope (explicitly deferred, not addressed here): the
  buffered-vs-streaming `bridgeCrossRealmPreview` wire frame in
  `@riftydev/net` and any `SW_FRAME_VERSION` bump. Real Vite's
  vendor-prebundle / source-map responses will eventually force a
  streaming split under its own ADR; the buffered shape is correct
  until a body too large to fit appears.

## Acceptance criteria

- [x] `PreviewOwnerBinding` / `ReadinessSignal` / `ReadinessSubscription`
      contract defined, designed from both window and worker consumers.
- [x] `FirstWindowOwnerBinding` wraps the historical
      `FirstWindowOwnerResolver` + `ReadyClientsRegistry` with no
      behaviour change; default for `createPreviewInterceptor`.
- [x] `WorkerOwnerBinding` routes by port, revalidates the owner via
      `clients.get`, and surfaces `'gone'` for the no-`pagehide`
      lifecycle.
- [x] `createPreviewInterceptor` resolves owners and gates readiness
      THROUGH the binding; `WorkerOwnerBinding` selectable via
      `hooks.binding`; exported from `@riftydev/service-worker`.
- [x] No `SW_FRAME_VERSION` / `SW_ROUTING_VERSION` bump — `ports` is
      additive optional.
- [x] Dual-strategy parity test plus worker-specific lifecycle cases.
- [x] `@riftydev/service-worker` CHANGELOG updated with an ADR-0046 entry.

## References

- ADR-0011 — sync IPC via SharedArrayBuffer + Atomics; Worker-as-process
  model. Provides the kernel-spawned-Worker realm with
  `Client.type === 'worker'` that A-023 routes to.
- ADR-0017 — `@riftydev/net` cross-realm port-registry bridge. The
  `ports: number[]` field mirrors a Worker's `serveCrossRealmPreview`
  registrations so the SW resolves port → Worker without a separate
  registry round-trip.
- ADR-0031 — every SW↔main wire frame carries version fields validated
  at decode; additive optional fields with a default need no major bump.
- ADR-0040 — split into `SW_FRAME_VERSION` (frame data) and
  `SW_ROUTING_VERSION` (addressing + owner-fallback). The binding's
  owner-fallback semantics sit under routing; the additive `ports`
  field sits under frame — neither constant moves.
- ADR-0043 — Vite-in-Worker realm and cross-realm preview bridge; made
  A-023 the next consumer of the bridge primitive and the forcing
  consumer that closes Q-2026-05-27-002.
- OPEN_QUESTIONS.md — Q-2026-05-27-002, promoted by this ADR.
