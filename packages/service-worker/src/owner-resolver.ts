/**
 * Strategy for resolving the realm that owns the in-process preview for a
 * `/preview/<port>/*` fetch. An injectable seam so the M11 migration to a
 * Worker-hosted Vite is a swap of the default, not a fork of the
 * route-preview pipeline.
 *
 * M10 owner: a window `Client` (playground main thread serving the in-process
 * port registry). M11 (A-026 Vite-in-Worker; A-023 SW→Worker registry): a
 * kernel-spawned Worker, landing a `WorkerOwnerResolver` plus a one-line
 * `installPreviewInterceptor` default swap. The route-preview path is
 * unchanged either way: ask resolver, gate on ready handshake, post, await.
 *
 * Refs: ADR-0011 (Sync IPC via SAB; kernel-spawned-Worker model A-023 reuses),
 * ADR-0017 (`@riftydev/net` cross-realm port-registry bridge), ADR-0025
 * (main-thread dev servers; superseded for Real Vite by A-026), A-023 / A-026.
 */

/**
 * Resolve the realm that owns the process registered for a preview fetch.
 *
 * M10 returns a window `Client`. M11 returns a `worker`-type `Client` via a
 * `WorkerOwnerResolver`; the pipeline is identical because `Client.postMessage`
 * is shape-compatible across `type === 'window'` and `type === 'worker'`.
 *
 * Implementations MUST return `null` when no owner resolves; the route-preview
 * path translates that to an HTTP 503.
 *
 * @param scope - SW global scope (provides `clients`).
 * @param request - Fetch being routed. Reserved for URL-keyed resolvers; the
 *   default resolver ignores it.
 * @param clientId - Owning client id from the fetch event
 *   (`event.resultingClientId || event.clientId`), or `null` when both are
 *   empty (navigation-preload edge cases). ADR-0031.
 */
export interface PreviewOwnerResolver {
  resolveOwner(
    scope: ServiceWorkerGlobalScope,
    request: Request,
    clientId: string | null,
  ): Promise<Client | null>;
}

// Warn-once-per-scope for the no-clientId fallback: visible without spamming
// every fetch. Keyed by scope identity, stable across the SW's lifetime.
const fallbackWarned = new WeakSet<ServiceWorkerGlobalScope>();

/**
 * Default resolver, preserving M10 routing behaviour.
 *
 * Prefers the `FetchEvent` `clientId`. Falls back to the first controlled
 * window only when the event has no id; in a multi-window page this *will*
 * misroute, hence the warn-once (ADR-0031).
 *
 * The fallback order, the dedup key shape, and the warn-once semantics are
 * part of the routing contract pinned by `SW_ROUTING_VERSION` (ADR-0040);
 * changing any requires bumping that constant so peer drift is caught at
 * handshake time instead of silently misrouting.
 *
 * M11 A-026 swaps the `installPreviewInterceptor` default to a
 * `WorkerOwnerResolver`; this stays as the documented fallback for
 * non-isolated environments (ADR-0025).
 */
export class FirstWindowOwnerResolver implements PreviewOwnerResolver {
  async resolveOwner(
    scope: ServiceWorkerGlobalScope,
    _request: Request,
    clientId: string | null,
  ): Promise<Client | null> {
    if (clientId) {
      const direct = (await scope.clients.get(clientId)) as Client | undefined;
      if (direct) return direct;
    }
    const all = await scope.clients.matchAll({
      type: 'window',
      includeUncontrolled: false,
    });
    if (all.length === 0) return null;
    if (!fallbackWarned.has(scope)) {
      fallbackWarned.add(scope);
      // eslint-disable-next-line no-console
      console.warn(
        '[rifty/service-worker] preview fetch had no clientId; falling back to first controlled window',
      );
    }
    return all[0] ?? null;
  }
}
