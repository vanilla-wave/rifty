# ADR 0125: Preview owner binding — async resolution, ready-window preference, clientId sentinels

Status: Accepted (supersedes ADR-0046, removed)
Date: 2026-06-12

> TL;DR: re-records the `PreviewOwnerBinding` contract from ADR-0046 minus its
> microtask-timing invariant (`resolveOwner` is `async` by design; the
> invariant's rationale was stale). Gives an ADR home to two normative
> `SW_ROUTING_VERSION` `'3'` rules that had none: ready-window preference for
> no-clientId fallback, and the clientId sentinel trichotomy (`id` / `''` / `null`).

## Context

ADR-0046's "Microtask-timing invariant" required `FirstWindowOwnerBinding.resolveOwner` and `waitForReady` to return inner promises directly (methods NOT `async`), claiming handshake tests gate on a fixed microtask budget. Shipped code contradicts it: `packages/service-worker/src/owner-binding-window.ts` `resolveOwner` is `async`, multi-await — resolver await plus a conditional `clients.matchAll` ready-window scan. Active ADRs are immutable, so the contradiction ends here: 0046 removed, load-bearing context grafted below.

The invariant's rationale was stale when the code changed: the handshake helper `flushPreviewDispatch` has had a generous 8-microtask-turn budget since 7b78048 (pre-dating the async change); no test was modified to absorb the extra await-unwrap turn — all pass unchanged. It is also production-unobservable: `routePreview` awaits `resolveOwner` before readiness gating, and cross-realm `postMessage` delivery is task-granular.

Separately, two rules pinned by `SW_ROUTING_VERSION` `'3'` (`packages/service-worker/src/protocol.ts` TSDoc, package README) had no ADR home: the ready-window preference (`owner-binding-window.ts` TSDoc cited ADR-0123, which does not record it — dangling normative citation) and the clientId sentinel meanings synthesized in `preview-bridge.ts`. ADR-0097 records only the frame port context + the copied-top-level unique-worker fallback.

## Decision

### 1. Drop the microtask-timing invariant — binding methods may be `async`

Binding methods are not timing-constrained. `resolveOwner` is `async` and may multi-await (owner resolution, `clients.matchAll`, `clients.get` revalidation). Handshake tests pin dispatch within the 8-turn flush budget, not exact turn counts. `waitForReady` still returns the registry promise directly — implementation style, not contract; an extra unwrap turn is tolerated.

Options: keep the invariant and revert the async method — rejected: the ready-window scan needs `clients.matchAll` (inherently async) and the invariant's premise (fixed-turn test gating) was already false. Re-pin tests on exact turn counts — rejected: brittle, pins an unobservable.

### 2. Ready-window preference for no-clientId fallback (normative, v3)

When `clientId` is falsy and `FirstWindowOwnerResolver` falls back to the first controlled window: if a readiness signal exists and that window is neither ready nor mismatched, prefer a controlled window that IS ready; else keep the first match.

Why: a copied top-level `/preview/<port>/` tab is itself a controlled, unready window client; browser enumeration may return it before the playground page that mounted the preview bridge — plain first-window fallback would route the preview request to the preview tab itself.

Options:
- keep first-window fallback — rejected: self-routing above.
- per-tab parent-client attribution for embedded iframes — impossible: the SW Clients API exposes no parent-client link for anonymous (`''`) iframe traffic.
- ready-window preference — chosen: cheapest rule that excludes the unready preview tab.

Honest residual: anonymous embedded iframe traffic (`''`) has NO per-tab attribution — a multi-window playground routes it via the most-recently-focused ready window (`clients.matchAll` order); warn-once in `owner-resolver.ts`.

### 3. clientId sentinel trichotomy (normative, v3)

`preview-bridge.ts` synthesizes the `clientId` handed to `resolveOwner`:

- **real id** — direct attribution via `clients.get`.
- **`''`** — anonymous-but-embedded (known frame context, not copied top-level): window fallback + ready-window preference; `PortAwareOwnerBinding` skips the worker fast-path.
- **`null`** — copied top-level / unknown frame context: unique-worker fast-path (`resolvePortOwners`) — route directly when exactly one live Worker claims the port, 503 when several do (preserves ADR-0123 multi-window isolation), window fallback when none.

No `SW_ROUTING_VERSION` bump: both rules shipped inside the `'2'`→`'3'` bump (ADR-0097 wave); this ADR records the wire contract, it does not change it.

### Grafted contract (from ADR-0046, condensed)

- `PreviewOwnerBinding { resolveOwner(scope, request, clientId, port): Promise<Client | null>; subscribeReadiness(scope): ReadinessSubscription }`. `null` owner → 503. Window binding ignores `port` (a window owns every page-registered port); worker binding routes by it.
- `subscribeReadiness` installs the binding's message listener and returns `{ readiness: ReadinessSignal, teardown() }`; one subscription per `createPreviewInterceptor`, so bindings never share mutable readiness state.
- `ReadinessSignal.waitForReady` resolves `ReadinessOutcome = 'ready' | 'timeout' | 'mismatch' | 'gone'`; never rejects.
- **`'gone'` + the no-`pagehide` worker trap.** Workers have no `pagehide`/`controllerchange`; a dead Worker may never send goodbye. `WorkerOwnerBinding` closes it twice: goodbye drops exactly the named port→owner mappings and resolves pending waiters `'gone'`; lazy revalidation at fetch time (`clients.get(ownerId)` → `undefined`) drops the stale mapping, resolves `'gone'`, returns `null`. `route-preview` maps `'gone'` to a distinct 503. The window binding never emits `'gone'`: a window goodbye surfaces as `'timeout'` (back-compat, byte-for-byte).
- Port-keyed worker routing: `port → ownerId` + inverse `ownerId → Set<port>`; a port mapping is dropped only if it still points at the departing owner (clean handover to a fresh claimant). Per-scope state behind a `WeakMap`.
- Frame-version stance: `ports` / `ownerToken` are additive optional fields with documented defaults → no `SW_FRAME_VERSION` bump (ADR-0031 rule, restated by ADR-0040). `SW_FRAME_VERSION` stays `'1'`.
- Wiring: `createPreviewInterceptor(scope, hooks)` builds the binding (default now `PortAwareOwnerBinding` per ADR-0123; was `FirstWindowOwnerBinding` at 0046), calls `subscribeReadiness(scope)`, threads signal + binding into `routePreview` — the single seam all bindings flow through. Back-compat `hooks.resolver` ≡ `binding: new PortAwareOwnerBinding({ window: { resolver } })`; `binding` wins when both supplied.
- Seam options 0046 weighed (kept for audit): **A** — one binding interface designed from both window+worker consumers (chosen); **B** — parallel window/worker route-preview paths (rejected: near-duplicate flows, lifecycle asymmetry leaks into the interceptor); **C** — `Client.type` special-casing inside the window registry (rejected: no place to express owner-died-without-goodbye).

## Consequences

- ADR-0046 removed; the README Superseded table points here. ADR-0046 citations in immutable ADRs (0028, 0048, 0073, 0097, 0123) and code TSDoc resolve via the removed-row / git history per the Historical-references policy.
- Stale rationale in `owner-binding-window.ts` (the "NOT async / fixed microtask turns" note on `waitForReady`; the ADR-0123 citation for ready-window preference) re-pointed here in the same PR.
- v3 owner selection is now fully ADR-homed: ADR-0123 (owner-token scoping, v2) + ADR-0097 (frame port context, copied-top-level worker fallback, v3 bump) + this ADR (ready-window preference, sentinel trichotomy, async-tolerant binding methods).
- Negative (unchanged from 0046): the window binding cannot distinguish goodbye from timeout; `'gone'` stays worker-only. Promoting window goodbye to `'gone'` changes an observable outcome — future ADR if needed.
- Negative: multi-window anonymous-embedded attribution stays heuristic (most-recently-focused ready window) until the platform grows a parent-client link.
- 0046's deferred streaming split has since landed as ADR-0048; no open deferral remains here.
- Dual-strategy parity test (`packages/service-worker/tests/preview-owner-binding-parity.test.ts`) still runs both bindings; handshake tests gate via the 8-turn flush budget.

## Cited ADRs and references

- ADR-0011 — Worker-as-process realm the worker binding routes to.
- ADR-0017 — `ports` mirrors a Worker's `serveCrossRealmPreview` registrations.
- ADR-0031 — `resultingClientId || clientId` preference; additive-optional-no-bump rule; first-window warn-once.
- ADR-0040 — `SW_FRAME_VERSION` / `SW_ROUTING_VERSION` split; owner fallback sits under routing.
- ADR-0043 — Vite-in-Worker realm; forcing consumer for the binding seam.
- ADR-0046 — predecessor, removed; context grafted above. Promoted Q-2026-05-27-002 (carried here).
- ADR-0048 — streaming cross-realm wire-frame; closed 0046's deferred streaming split.
- ADR-0074 (removed → ADR-0077) — preview-nav routing predecessor.
- ADR-0077 — preview iframe requests route to the controlling window owner.
- ADR-0097 — frame port context; copied-top-level unique-worker fallback; the v3 bump.
- ADR-0123 — owner-token-scoped worker routing; `PortAwareOwnerBinding` default.
