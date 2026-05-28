/**
 * Shared "preview owner binding" interface — the seam between the SW's
 * preview interceptor and whatever realm actually owns the
 * `/preview/<port>/*` handler.
 *
 * Designed from BOTH consumers at once (ADR-0046, promoting
 * Q-2026-05-27-002):
 *
 *  1. {@link FirstWindowOwnerBinding} (`./owner-binding-window.ts`) wraps
 *     the historical `FirstWindowOwnerResolver` + `ReadyClientsRegistry`
 *     pair. The owner is a window `Client`; readiness arrives via
 *     `postMessage` from `setupPreviewBridge` on the page realm; the
 *     teardown signal is `pagehide` / `controllerchange` (both lead to
 *     the page posting `rifty:preview:goodbye`).
 *
 *  2. {@link WorkerOwnerBinding} (`./owner-binding-worker.ts`) is the
 *     M11 A-023 (SW→Worker direct routing) addition. The owner is a
 *     `Client` of `type === 'worker'`; readiness arrives via the same
 *     `rifty:preview:ready` frame but with an extra `ports: number[]`
 *     field naming which preview ports the Worker is willing to serve.
 *     There is no `pagehide` on Workers; the goodbye signal is either an
 *     explicit `rifty:preview:goodbye` on Worker termination OR a lazy
 *     `clients.get(id) === undefined` lookup at fetch time when a Worker
 *     died without a chance to send goodbye.
 *
 * The binding shape is:
 *
 *  - `resolveOwner(scope, request, clientId, port)` — returns the owning
 *    `Client` for this fetch, or `null` if none can be located. The
 *    `port` is carried because the Worker binding routes by port
 *    (multiple Workers may host different preview ports on the same
 *    page); the window binding ignores it (the window IS the owner of
 *    every preview port the page registers via `setupPreviewBridge`).
 *
 *  - `subscribeReadiness(scope)` — installs the binding's message
 *    listener (or whatever channel it uses) on the SW scope and returns
 *    a {@link ReadinessSignal} the route-preview pipeline gates on. The
 *    returned signal MUST be safe to call across multiple in-flight
 *    fetches (no shared mutable cursor between them beyond
 *    `nextRequestId`, which is monotonic per binding instance per
 *    spec). The returned `teardown` removes whatever listeners the
 *    binding installed.
 *
 * Both consumers expose the SAME {@link PreviewOwnerBinding} shape; the
 * interceptor stays binding-agnostic. The window vs worker choice is the
 * runtime decision the playground makes when installing the interceptor.
 *
 * ## Why this is one interface, not two
 *
 * Q-2026-05-27-002 weighed defining the binding ahead of the second
 * consumer (Option A) against deferring until both consumers existed
 * (Option B). B won at the time on the grounds that "two concrete
 * consumers shape the interface from real signals." A-023 is that second
 * consumer; this module is the binding designed from both shapes
 * simultaneously, and ADR-0046 closes the question.
 *
 * Cited ADRs:
 * - **ADR-0011** — sync IPC + worker-as-process. A-023 reuses the
 *   kernel-spawned-Worker `Client.type === 'worker'` shape.
 * - **ADR-0017** — `@rifty/net` cross-realm port-registry bridge.
 *   Workers register their preview ports via
 *   `@rifty/net.serveCrossRealmPreview(port, …)`. The Worker binding's
 *   readiness frame mirrors that registration so the SW can resolve
 *   port → Worker without a separate registry round-trip.
 * - **ADR-0040** — `SW_FRAME_VERSION` / `SW_ROUTING_VERSION` split. The
 *   binding contract is part of `SW_ROUTING_VERSION` (it pins owner
 *   fallback semantics); the worker-readiness `ports: number[]` field
 *   is additive (default empty) and does NOT require a `SW_FRAME_VERSION`
 *   bump per ADR-0031's SemVer-major rule.
 * - **ADR-0043** — Vite-in-Worker. Made A-023 the next consumer of the
 *   cross-realm bridge primitive.
 * - **ADR-0046** — Promotes Q-2026-05-27-002; this binding is its
 *   contract.
 */

/**
 * Outcome of {@link ReadinessSignal.waitForReady}.
 *
 *  - `'ready'` — the owner is currently ready to receive requests.
 *  - `'timeout'` — the timeout fired before readiness arrived.
 *  - `'mismatch'` — the owner posted a `rifty:preview:ready` frame whose
 *    frame or routing version did not match this SW's pair (ADR-0040).
 *  - `'gone'` — the binding detected that the owner is no longer present
 *    (e.g. a Worker terminated, or a window posted goodbye) while we
 *    were waiting. Distinct from `'timeout'` so the route-preview path
 *    can return a clearer 503.
 */
export type ReadinessOutcome = 'ready' | 'timeout' | 'mismatch' | 'gone';

/**
 * Per-binding shared state the route-preview pipeline reads to gate
 * each fetch. Owned by the binding instance — each
 * `createPreviewInterceptor` call has its own
 * {@link PreviewOwnerBinding} and thus its own
 * {@link ReadinessSignal} (so tests in the same process don't bleed
 * state).
 */
export interface ReadinessSignal {
  /** Is the owner identified by `ownerId` currently considered ready? */
  isReady(ownerId: string): boolean;
  /** Has the owner posted a mismatched protocol version? */
  isMismatched(ownerId: string): boolean;
  /**
   * Wait until the owner becomes ready, or until `timeoutMs` elapses,
   * or until the owner is detected as gone. Resolves with the
   * {@link ReadinessOutcome} — never rejects. Multiple concurrent
   * waiters for the same `ownerId` all resolve together.
   */
  waitForReady(ownerId: string, timeoutMs: number): Promise<ReadinessOutcome>;
  /**
   * Allocate the next outbound request id for `rifty:preview:request`
   * frames dispatched on behalf of this interceptor. Each binding owns
   * its own counter so multiple bindings in the same process (tests,
   * future per-realm bindings) don't share monotonically-increasing
   * state.
   */
  nextRequestId(): number;
}

/**
 * Handle returned by {@link PreviewOwnerBinding.subscribeReadiness}.
 * Composes the live readiness signal with a teardown to remove the
 * binding-installed listeners from the scope.
 */
export interface ReadinessSubscription {
  readonly readiness: ReadinessSignal;
  teardown(): void;
}

/**
 * Shared binding interface — the seam every preview interceptor sits on
 * top of. Implementations are stateful: each call to
 * {@link subscribeReadiness} attaches listeners and returns a
 * {@link ReadinessSubscription} tied to those listeners.
 *
 * Lifecycle differences between window and worker owners are isolated
 * inside the binding implementation; the interceptor only sees the
 * uniform `resolveOwner` / `ReadinessSignal` API.
 *
 *  - Window binding: `pagehide` / `controllerchange` translate into the
 *    page posting `rifty:preview:goodbye`, which the binding's
 *    `subscribeReadiness` listener consumes and flips the owner out of
 *    the ready set.
 *  - Worker binding: no `pagehide` / `controllerchange`. The Worker
 *    sends `rifty:preview:goodbye` on termination if it can; otherwise
 *    `resolveOwner` returns `null` once `scope.clients.get(id)` reports
 *    the Worker is gone, and any in-flight `waitForReady` resolves with
 *    `'gone'` instead of hanging until timeout.
 */
export interface PreviewOwnerBinding {
  /**
   * Identify the owning {@link Client} for the given preview fetch.
   *
   * @param scope - The SW global scope (provides `clients`).
   * @param request - The fetch request being routed. The window binding
   *   ignores it; the worker binding may key off the URL or headers in
   *   the future.
   * @param clientId - The owning client id surfaced by the fetch event
   *   (`event.resultingClientId || event.clientId`), or `null` when
   *   both ids are empty.
   * @param port - The preview port from the matched URL
   *   (`/preview/<port>/…`). The worker binding routes by port; the
   *   window binding ignores it.
   * @returns The owning client, or `null` when no owner can be
   *   resolved (the route-preview path translates `null` into HTTP 503).
   */
  resolveOwner(
    scope: ServiceWorkerGlobalScope,
    request: Request,
    clientId: string | null,
    port: number,
  ): Promise<Client | null>;

  /**
   * Attach the binding's message / readiness listeners to the SW scope
   * and return a live {@link ReadinessSignal} the route-preview
   * pipeline gates on. Multiple subscriptions on the same scope are
   * supported (tests); each one carries its own readiness state.
   */
  subscribeReadiness(scope: ServiceWorkerGlobalScope): ReadinessSubscription;
}
