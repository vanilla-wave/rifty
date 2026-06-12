/**
 * Shared "preview owner binding" interface — seam between the SW's preview
 * interceptor and whatever realm owns the `/preview/<port>/*` handler.
 *
 * Designed from BOTH consumers at once (ADR-0046, promoting
 * Q-2026-05-27-002):
 *
 *  1. {@link FirstWindowOwnerBinding} (`./owner-binding-window.ts`) wraps the
 *     `FirstWindowOwnerResolver` + `ReadyClientsRegistry` pair. Owner is a
 *     window `Client`; readiness arrives via `postMessage` from
 *     `setupPreviewBridge` on mount, heartbeat, and `controllerchange`.
 *     Teardown posts `rifty:preview:goodbye`.
 *
 *  2. {@link WorkerOwnerBinding} (`./owner-binding-worker.ts`) — the M11
 *     A-023 (SW→Worker direct routing) addition. Owner is a `Client` with
 *     `type === 'worker'`; readiness arrives via the same
 *     `rifty:preview:ready` frame plus `ownerToken` and `ports: number[]`
 *     fields naming the page owner scope and preview ports the Worker serves.
 *     Workers have no `pagehide`; goodbye is either explicit
 *     `rifty:preview:goodbye` on termination OR a lazy `clients.get(id) ===
 *     undefined` lookup at fetch time when a Worker died without sending
 *     goodbye.
 *
 * `resolveOwner` carries `port` because the Worker binding routes by
 * `(ownerToken, port)` (multiple Workers may host different preview ports on one
 * page); the window binding ignores it (the window owns every port it registers via
 * `setupPreviewBridge`). `subscribeReadiness` returns a {@link ReadinessSignal}
 * that MUST be safe across concurrent in-flight fetches (no shared mutable
 * cursor beyond the monotonic `nextRequestId`).
 *
 * Both consumers expose the SAME shape; the interceptor stays
 * binding-agnostic. The default {@link PortAwareOwnerBinding} composes both:
 * matching Worker-owned `(ownerToken, port)` routes win, window-owned ports keep
 * the legacy fallback.
 *
 * One interface, not two: Q-2026-05-27-002 deferred defining the binding
 * until both consumers existed so "two concrete consumers shape the interface
 * from real signals." A-023 is that second consumer; ADR-0046 closes it.
 *
 * Cited ADRs:
 * - **ADR-0011** — sync IPC + worker-as-process; A-023 reuses the
 *   kernel-spawned-Worker `Client.type === 'worker'` shape.
 * - **ADR-0017** — `@riftydev/net` cross-realm port-registry bridge. The
 *   Worker readiness frame mirrors `serveCrossRealmPreview(port, …)`
 *   registration so the SW resolves `(ownerToken, port)` → Worker without a
 *   registry round-trip.
 * - **ADR-0040** — `SW_FRAME_VERSION` / `SW_ROUTING_VERSION` split. Binding
 *   contract lives in `SW_ROUTING_VERSION`; the additive `ownerToken` and
 *   `ports: number[]` fields need no `SW_FRAME_VERSION` bump per ADR-0031's
 *   SemVer-major rule.
 * - **ADR-0043** — Vite-in-Worker; made A-023 the next consumer of the
 *   cross-realm bridge.
 * - **ADR-0046** — promotes Q-2026-05-27-002; this binding is its contract.
 */

/**
 * Outcome of {@link ReadinessSignal.waitForReady}.
 *
 *  - `'ready'` — owner ready to receive requests.
 *  - `'timeout'` — timeout fired before readiness arrived.
 *  - `'mismatch'` — owner posted a `rifty:preview:ready` whose frame/routing
 *    version did not match this SW's pair (ADR-0040).
 *  - `'gone'` — owner left while waiting (Worker terminated, or window posted
 *    goodbye). Distinct from `'timeout'` so route-preview returns a clearer
 *    503.
 */
export type ReadinessOutcome = 'ready' | 'timeout' | 'mismatch' | 'gone';

/**
 * Per-binding shared state the route-preview pipeline reads to gate each
 * fetch. Owned by the binding instance — each `createPreviewInterceptor` has
 * its own {@link ReadinessSignal} so tests in one process don't bleed state.
 */
export interface ReadinessSignal {
  /** Is `ownerId` currently considered ready? */
  isReady(ownerId: string): boolean;
  /** Has `ownerId` posted a mismatched protocol version? */
  isMismatched(ownerId: string): boolean;
  /** Optional owner scope declared by this owner during readiness. */
  ownerToken?(ownerId: string): string | undefined;
  /**
   * Wait until the owner is ready, `timeoutMs` elapses, or the owner is gone.
   * Never rejects. Concurrent waiters for the same `ownerId` resolve together.
   */
  waitForReady(ownerId: string, timeoutMs: number): Promise<ReadinessOutcome>;
  /**
   * Next outbound request id for `rifty:preview:request` frames. Per-binding
   * counter so bindings in one process (tests) don't share monotonic state.
   */
  nextRequestId(): number;
}

/**
 * Handle returned by {@link PreviewOwnerBinding.subscribeReadiness}: the live
 * readiness signal plus a teardown that removes the binding's scope listeners.
 */
export interface ReadinessSubscription {
  readonly readiness: ReadinessSignal;
  teardown(): void;
}

/**
 * Shared binding interface — the seam every preview interceptor sits on.
 * Stateful: each {@link subscribeReadiness} attaches listeners and returns a
 * {@link ReadinessSubscription} tied to them. Window/worker lifecycle
 * differences stay inside the implementation; the interceptor only sees the
 * uniform `resolveOwner` / `ReadinessSignal` API.
 *
 *  - Window: mounted pages post `rifty:preview:ready` on mount, heartbeat, and
 *    `controllerchange`; teardown posts `rifty:preview:goodbye`, flipping the
 *    owner out of the ready set.
 *  - Worker: no `pagehide`. Worker sends `rifty:preview:goodbye` on
 *    termination if it can; otherwise `resolveOwner` returns `null` once
 *    `scope.clients.get(id)` reports it gone, and in-flight `waitForReady`
 *    resolves `'gone'` instead of hanging until timeout.
 */
export interface PreviewOwnerBinding {
  /**
   * Identify the owning {@link Client} for a preview fetch.
   *
   * @param scope - SW global scope (provides `clients`).
   * @param request - Fetch request being routed. Window binding ignores it;
   *   worker binding may key off URL/headers in the future.
   * @param clientId - Owner-attribution sentinel synthesized by the
   *   interceptor, NOT the raw event id (ADR-0125): a real client id = direct
   *   attribution; `''` = anonymous-but-embedded preview traffic (window
   *   fallback + ready-window preference); `null` = copied top-level / unknown
   *   frame context (unique-worker fast path, 503 on ambiguity).
   * @param port - Preview port from the matched URL (`/preview/<port>/…`).
   *   Worker binding routes by it; window binding ignores it.
   * @returns Owning client, or `null` if none resolved (route-preview turns
   *   `null` into HTTP 503).
   */
  resolveOwner(
    scope: ServiceWorkerGlobalScope,
    request: Request,
    clientId: string | null,
    port: number,
  ): Promise<Client | null>;

  /**
   * Attach the binding's readiness listeners to `scope` and return a live
   * {@link ReadinessSignal} the route-preview pipeline gates on. Multiple
   * subscriptions per scope are supported (tests); each carries its own state.
   */
  subscribeReadiness(scope: ServiceWorkerGlobalScope): ReadinessSubscription;
}
