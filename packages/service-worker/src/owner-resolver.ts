/**
 * Strategy for resolving the realm that owns the in-process preview for a
 * given `/preview/<port>/*` fetch. Extracted so the M11 migration to a
 * Worker-hosted Vite is a swap of the default — not a fork of the
 * route-preview pipeline.
 *
 * Today (M10) the owner is a window `Client` (the playground main thread that
 * boots `@rifty/net` and serves the in-process port registry). Tomorrow
 * (M11, A-026 — Vite-in-Worker; A-023 — SW → Worker process registry) the
 * owner becomes the kernel-spawned Worker that registered the port. The
 * route-preview path stays the same: it asks the resolver, gates on the
 * ready handshake, posts the request, awaits the reply.
 *
 * The resolver is an injectable seam. `createPreviewInterceptor` defaults to
 * `FirstWindowOwnerResolver`, which carries the pre-M11 behaviour verbatim.
 * The M11 patch lands a `WorkerOwnerResolver` and a one-line change to
 * `installPreviewInterceptor` to pass it.
 *
 * Cited ADRs and action items:
 * - **ADR-0011** — Sync IPC via SAB; defines the kernel-spawned-Worker model
 *   that A-023 reuses for the SW→Worker registry.
 * - **ADR-0017** — `@rifty/net` cross-realm port-registry bridge.
 * - **ADR-0025** — Toolchain dev servers run on the main thread today;
 *   superseded for the Real Vite path by A-026.
 * - **A-023** (REVIEW_ACTIONS.md) — SW → Worker rewires through the port
 *   registry once A-026 lands.
 * - **A-026** (REVIEW_ACTIONS.md) — Vite migrates from the page realm to a
 *   kernel-spawned Worker.
 */

/**
 * Resolve the realm that owns the process registered for the given preview
 * fetch.
 *
 * Today returns a window `Client` (the playground main thread). In M11, a
 * `WorkerOwnerResolver` consulting the cross-realm `@rifty/net` port
 * registry returns a `Worker`-type `Client` instead — the route-preview
 * pipeline stays identical because `Client.postMessage` is shape-compatible
 * across `type === 'window'` and `type === 'worker'`.
 *
 * Implementations MUST return `null` when no owner can be resolved; the
 * route-preview path translates that to an HTTP 503 with a clear message.
 *
 * @param scope - The Service Worker global scope (provides `clients`).
 * @param request - The fetch request being routed. Reserved for future
 *   resolvers that key off URL — the default resolver ignores it.
 * @param clientId - The owning client id surfaced by the fetch event
 *   (`event.resultingClientId || event.clientId`), or `null` when both
 *   ids are empty (navigation-preload edge cases). ADR-0031.
 */
export interface PreviewOwnerResolver {
  resolveOwner(
    scope: ServiceWorkerGlobalScope,
    request: Request,
    clientId: string | null,
  ): Promise<Client | null>;
}

// One-shot dedup: the no-clientId fallback warns once per SW scope so the
// signal is visible without spamming the console on every fetch. Keyed by
// scope identity, which is stable across the SW's lifetime.
const fallbackWarned = new WeakSet<ServiceWorkerGlobalScope>();

/**
 * Default resolver — preserves the M10 routing behaviour verbatim.
 *
 * Prefers the `clientId` carried by the `FetchEvent`. Falls back to the
 * first controlled window only when the event has no id — warns once per
 * scope because in a multi-window page this *will* misroute (ADR-0031).
 *
 * M11 A-026 lands a `WorkerOwnerResolver` alongside this class and swaps
 * the `installPreviewInterceptor` default; this implementation stays as
 * the documented fallback for non-isolated environments (ADR-0025).
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
