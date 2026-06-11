# ADR 0046: `PreviewOwnerBinding` — one seam for window and worker preview owners

Status: Accepted (promoted from Q-2026-05-27-002)
Date: 2026-05

> TL;DR: SW preview interceptor sits on one `PreviewOwnerBinding` seam; `FirstWindowOwnerBinding` (client-id) + port-keyed `WorkerOwnerBinding` whose `'gone'` outcome traps no-`pagehide` Workers

## Context

The SW preview interceptor (`@riftydev/service-worker`) routes `/preview/<port>/*` fetches to the realm owning that port's handler. Through M10 that realm is always the playground window: `FirstWindowOwnerResolver` picks the owning `Client`, and a window-shaped `ReadyClientsRegistry` (in `preview-bridge.ts`) gates each fetch on the `rifty:preview:ready` handshake. Both halves assume `event.source` is a window `Client`.

Q-2026-05-27-002 deferred extracting a shared binding shape until a second consumer existed (a one-consumer interface almost always needs revision when the second arrives). A-023 (SW→Worker direct routing, on ADR-0043's Vite-in-Worker realm) is that consumer: the owner becomes a kernel-spawned `Client` of `type === 'worker'`. Workers have **no `pagehide` and no `controllerchange`**, so the window-only readiness model cannot absorb them. With both shapes concrete, the binding can be designed from both at once and the question closed.

The 2026-05-27 architecture review (item #4) attached a sibling deferral to the A-023 wave: `bridgeCrossRealmPreview` is buffered-only (`packages/net/src/cross-realm/preview-port.ts`). That is a **separate** cross-realm wire-frame concern, explicitly **not in scope here**. This ADR does not touch the cross-realm frame format, does not add streaming/chunked frames, and does not bump `SW_FRAME_VERSION`. The streaming split stays deferred to its own future ADR.

## Options considered

- **A — define `PreviewOwnerBinding` now, from both consumers (chosen).** One interface `{ resolveOwner, subscribeReadiness }` that the interceptor sits on, with two impls: `FirstWindowOwnerBinding` (wraps the historical resolver+registry pair) and `WorkerOwnerBinding` (port-keyed routing, worker-aware lifecycle). The interceptor stays binding-agnostic; window vs worker is a runtime choice the host makes at install.
- **B — keep the window path on bare `PreviewOwnerResolver` + registry, add a parallel worker path.** Rejected: forks route-preview into two near-duplicate flows, and the readiness/teardown asymmetry (windows post goodbye on `pagehide`; workers may die silently) leaks into the interceptor instead of being isolated behind one seam.
- **C — fold worker support into the window registry via `Client.type` special-casing.** Rejected: the window registry's contract (`'ready' | 'timeout' | 'mismatch'`, goodbye-on-`pagehide`) has no place to express "owner terminated without goodbye"; a fourth state on a window-shaped object muddies both consumers.

## Decision

Adopt option **A**. The contract lives in `packages/service-worker/src/preview-owner-binding.ts`, designed from both consumers.

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

- **`resolveOwner`** returns the owning `Client`, or `null` when none is found (route-preview maps `null` to HTTP 503). `port` is carried because the worker binding routes by port (multiple Workers may host different ports); the window binding ignores it (a window owns every port the page registers via `setupPreviewBridge`). At ADR-0046 landing, the window binding forwarded the historical `clientId`-then-first-window fallback from ADR-0031; later ADR-0123 refines no-clientId copied preview URLs to prefer an already-ready window and to refuse ambiguous same-port Worker owners.
- **`subscribeReadiness`** installs the binding's message listener on the SW scope and returns a `ReadinessSubscription`: a live `ReadinessSignal` the route-preview pipeline gates on, plus `teardown()` that removes binding-installed listeners. Each `createPreviewInterceptor` call owns one subscription, so multiple bindings in one process (tests, future per-realm bindings) never share mutable readiness state.

`ReadinessSignal.waitForReady` resolves with a `ReadinessOutcome` and **never rejects**:

```ts
type ReadinessOutcome = 'ready' | 'timeout' | 'mismatch' | 'gone';
```

`'ready'`/`'timeout'`/`'mismatch'` keep their window meanings. **`'gone'` is new** (below).

### The `'gone'` outcome and the no-`pagehide` worker trap

The lifecycle hazard Q-2026-05-27-002 flagged. A window owner can post `rifty:preview:goodbye` on `pagehide`/teardown, so the registry drops it cleanly. A **Worker has no document → no `pagehide`, no `controllerchange`**: a crashed or kernel-terminated Worker may never send goodbye. Unhandled, an in-flight `waitForReady` for a dead Worker would hang the full timeout, and `resolveOwner` would return a stale `Client`.

`WorkerOwnerBinding` closes the trap two ways:

1. **Goodbye when possible.** On orderly termination the Worker posts `rifty:preview:goodbye` with the same `ports`; the binding drops exactly those port→owner mappings and resolves pending waiters with `'gone'`.
2. **Lazy revalidation at fetch time.** `resolveOwner` re-checks `scope.clients.get(workerId)`. If `undefined` (died without goodbye), it drops the stale mapping, resolves pending waiters with `'gone'`, and returns `null`.

`route-preview.ts` maps `'gone'` to a distinct 503 (`preview owner <id> departed before handshake`) so it is diagnosable and not conflated with a timeout. The window binding never emits `'gone'`: a window departure is a goodbye, which the legacy registry surfaces as `'timeout'` for back-compat — preserved byte-for-byte.

### Port-keyed routing (worker binding only)

`WorkerOwnerBinding` keeps a `port → ownerId` map plus the inverse `ownerId → Set<port>`, built from each Worker's ready frame. Routing `/preview/<port>/*` is a port lookup, not a client-id lookup (a Worker-served fetch carries no DOM `clientId`). Goodbye and silent-death both drop a Worker's port mappings precisely; a port mapping is dropped only if it still points at the departing owner, so a fresh Worker that already claimed the port keeps it (clean handover). Different ports route to different Workers.

### Why the additive `ports` field needs no `SW_FRAME_VERSION` bump

The worker readiness frame adds one **additive optional** field to `rifty:preview:ready`:

```ts
{ type: 'rifty:preview:ready', frameVersion: '1', routingVersion: '1',
  ports?: number[] }   // default []
```

ADR-0031 established that SW↔peer frames carry version fields validated at decode, and **additive optional fields with a documented default do NOT trigger a SemVer-major bump** (receiver treats `undefined` as the default). ADR-0040 restated that for the frame side when it split versioning into `SW_FRAME_VERSION` (data shapes) and `SW_ROUTING_VERSION` (addressing + owner-fallback). `ports` is compatible with the window ready frame: a window omits it, a worker supplies it, missing `ports` is `[]` (records readiness but claims no port — cannot accidentally claim port 0). So **`SW_FRAME_VERSION` stays `'1'`**. At ADR-0046 landing, `SW_ROUTING_VERSION` also stayed `'1'` because no default addressing or fallback order changed yet. ADR-0123 later changes owner selection semantics and bumps the routing contract through `'3'`; the frame version still stays `'1'`.

### Wiring

`createPreviewInterceptor(scope, hooks)` builds a `PreviewOwnerBinding`, calls `subscribeReadiness(scope)`, and threads both the returned `ReadinessSignal` and the binding into `routePreview`. `routePreview` is the single seam both bindings flow through: it asks `binding.resolveOwner`, gates on the signal, and forwards each fetch over a fresh `MessageChannel`. At ADR-0046 landing the default was `FirstWindowOwnerBinding`; ADR-0123 later makes `PortAwareOwnerBinding` the default so matching Worker-owned `(ownerToken, port)` routes win while page-owned paths keep the window fallback.

A back-compat `hooks.resolver` hook remains (equivalent to `binding: new FirstWindowOwnerBinding({ resolver })`) so existing `owner-resolver.test.ts` consumers compile unchanged; `binding` wins when both are supplied.

### Microtask-timing note

At ADR-0046 landing, `FirstWindowOwnerBinding.resolveOwner` and its `waitForReady` returned their inner promises directly to avoid changing the pre-existing handshake timing. Later routing refinements make `resolveOwner` async so it can inspect ready-window state for no-clientId copied preview tabs; the handshake tests now pin the current timing and dispatch behaviour rather than the original single-unwrap implementation detail. `waitForReady` still returns the registry promise directly.

## Consequences

- New public surface of `@riftydev/service-worker`: `PreviewOwnerBinding`, `ReadinessSignal`, `ReadinessSubscription`, `ReadinessOutcome`, `FirstWindowOwnerBinding` (+`FirstWindowOwnerBindingOptions`), `WorkerOwnerBinding` (+`WorkerOwnerBindingOptions`, `WorkerOwnerBindingLogger`). Additive — legacy `FirstWindowOwnerResolver` / `PreviewOwnerResolver` exports stay.
- The route-preview pipeline is genuinely binding-agnostic: window and worker owners share one flow.
- `ReadinessOutcome` gains `'gone'`; `route-preview.ts` returns a distinct 503 for it. Existing window outcomes unchanged.
- The worker binding adds per-instance `port → ownerId` state behind a `WeakMap<scope, state>`, so multiple interceptors in one process do not bleed routing state.
- A dual-strategy parity test (`tests/preview-owner-binding-parity.test.ts`) runs the same scenario set against both bindings, so a one-binding regression shows as a one-sided failure; worker-specific traps (silent death, port handover, multi-port routing, ready-without-ports) have dedicated cases.
- Negative: the window binding still cannot distinguish a genuine goodbye from a timeout (both surface as `'timeout'`), so `'gone'` is worker-only today. Promoting the window goodbye to `'gone'` would change an observable window outcome — left to a future ADR if a consumer needs it.
- Out of scope (deferred, not addressed): the buffered-vs-streaming `bridgeCrossRealmPreview` frame in `@riftydev/net` and any `SW_FRAME_VERSION` bump. Real Vite's vendor-prebundle / source-map responses will eventually force a streaming split under its own ADR; the buffered shape is correct until a body too large to fit appears.

## Acceptance criteria

- [x] `PreviewOwnerBinding` / `ReadinessSignal` / `ReadinessSubscription` contract defined, from both window and worker consumers.
- [x] `FirstWindowOwnerBinding` wraps the historical `FirstWindowOwnerResolver` + `ReadyClientsRegistry`; ADR-0123 later refines its no-clientId copied-preview fallback.
- [x] `WorkerOwnerBinding` routes by port, revalidates the owner via `clients.get`, and surfaces `'gone'` for the no-`pagehide` lifecycle.
- [x] `createPreviewInterceptor` resolves owners and gates readiness THROUGH the binding; `WorkerOwnerBinding` selectable via `hooks.binding`; exported from `@riftydev/service-worker`.
- [x] No `SW_FRAME_VERSION` bump for `ports` — additive optional frame fields do not change the frame shape. ADR-0123 later bumps `SW_ROUTING_VERSION` for owner-selection changes.
- [x] Dual-strategy parity test plus worker-specific lifecycle cases.
- [x] `@riftydev/service-worker` CHANGELOG updated with an ADR-0046 entry.

## References

- ADR-0011 — sync IPC via SharedArrayBuffer + Atomics; Worker-as-process model. Provides the kernel-spawned-Worker realm (`Client.type === 'worker'`) A-023 routes to.
- ADR-0017 — `@riftydev/net` cross-realm port-registry bridge. The `ports: number[]` field mirrors a Worker's `serveCrossRealmPreview` registrations so the SW resolves port → Worker without a separate registry round-trip.
- ADR-0031 — every SW↔main frame carries version fields validated at decode; additive optional fields with a default need no major bump.
- ADR-0040 — split into `SW_FRAME_VERSION` (frame data) and `SW_ROUTING_VERSION` (addressing + owner-fallback). The binding's owner-fallback sits under routing; the additive `ports` field under frame.
- ADR-0043 — Vite-in-Worker realm and cross-realm preview bridge; made A-023 the next consumer of the bridge primitive and the forcing consumer that closes Q-2026-05-27-002.
- ADR-0123 — port-aware owner routing, default `PortAwareOwnerBinding`, and routing-version bumps for owner-selection changes.
- OPEN_QUESTIONS.md — Q-2026-05-27-002, promoted by this ADR.
