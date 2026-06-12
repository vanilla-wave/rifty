/**
 * Window {@link PreviewOwnerBinding} — wraps {@link FirstWindowOwnerResolver}
 * + {@link createReadyClientsRegistry} behind the binding interface.
 *
 * Owner shape: a window `Client` (the playground page hosting
 * `setupPreviewBridge`). The page sends `rifty:preview:ready` on init and
 * heartbeat/controllerchange, then `rifty:preview:goodbye` on teardown; the
 * subscription consumes them.
 *
 * `resolveOwner` preserves the M10 resolver path first: prefer the `clientId`
 * carried by the `FetchEvent`, fall back to the first controlled window when the
 * id is empty, and warn once per scope for the multi-window misroute risk. For
 * no-clientId preview traffic (`''`/`null` sentinels), the binding then prefers
 * an already-ready window over an unready first match (ADR-0031, ADR-0040,
 * ADR-0125).
 *
 * The `port` argument is intentionally ignored — a window owns every preview port
 * the page registers via `setupPreviewBridge`, so there is no port-keyed dispatch
 * here. {@link WorkerOwnerBinding} consumes it.
 *
 * - ADR-0031 — prefer `event.resultingClientId`/`event.clientId`.
 * - ADR-0040 — owner-fallback rules pinned by `SW_ROUTING_VERSION`.
 * - ADR-0125 — the binding contract this module implements (supersedes ADR-0046).
 */

import { FirstWindowOwnerResolver, type PreviewOwnerResolver } from './owner-resolver.ts';
import type {
  PreviewOwnerBinding,
  ReadinessSignal,
  ReadinessSubscription,
} from './preview-owner-binding.ts';
import { SW_PREVIEW_GOODBYE, SW_PREVIEW_READY } from './protocol.ts';
import { type ReadyClientsLogger, createReadyClientsRegistry } from './ready-clients.ts';

/**
 * Per-binding options. `resolver` lets tests swap the strategy without
 * subclassing (default {@link FirstWindowOwnerResolver}); `logger` is
 * forwarded to {@link createReadyClientsRegistry}.
 */
export interface FirstWindowOwnerBindingOptions {
  readonly resolver?: PreviewOwnerResolver;
  readonly logger?: ReadyClientsLogger;
}

export class FirstWindowOwnerBinding implements PreviewOwnerBinding {
  readonly #resolver: PreviewOwnerResolver;
  readonly #logger: ReadyClientsLogger | undefined;
  readonly #readiness = new WeakMap<ServiceWorkerGlobalScope, ReadinessSignal>();

  constructor(opts: FirstWindowOwnerBindingOptions = {}) {
    this.#resolver = opts.resolver ?? new FirstWindowOwnerResolver();
    this.#logger = opts.logger;
  }

  async resolveOwner(
    scope: ServiceWorkerGlobalScope,
    request: Request,
    clientId: string | null,
    _port: number,
  ): Promise<Client | null> {
    const owner = await this.#resolver.resolveOwner(scope, request, clientId);
    if (clientId || !owner) return owner;
    const readiness = this.#readiness.get(scope);
    if (!readiness || readiness.isReady(owner.id) || readiness.isMismatched(owner.id)) {
      return owner;
    }
    // Copied top-level preview URLs create their own controlled window. Browser
    // enumeration may return that unready preview tab before the playground page
    // that actually mounted the preview bridge, so no-clientId fallback prefers
    // a ready window when one exists.
    const windows = await scope.clients.matchAll({
      type: 'window',
      includeUncontrolled: false,
    });
    return (
      (windows.find(
        (candidate) =>
          (!('type' in candidate) || candidate.type === 'window') &&
          readiness.isReady(candidate.id),
      ) as Client | undefined) ?? owner
    );
  }

  subscribeReadiness(scope: ServiceWorkerGlobalScope): ReadinessSubscription {
    const registry =
      this.#logger !== undefined
        ? createReadyClientsRegistry(this.#logger)
        : createReadyClientsRegistry();

    const messageHandler = (event: ExtendableMessageEvent | Event): void => {
      // Shares the `message` listener with the legacy interceptor wiring —
      // both filter ready/goodbye frames keyed by `event.source.id`.
      const ev = event as ExtendableMessageEvent;
      const data = ev.data as
        | { type?: string; frameVersion?: string; routingVersion?: string; ownerToken?: string }
        | null
        | undefined;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (data.type !== SW_PREVIEW_READY && data.type !== SW_PREVIEW_GOODBYE) return;
      const source = ev.source as Client | null;
      const sourceId = source && 'id' in source ? source.id : null;
      if (!sourceId) return;
      registry.handleMessage(sourceId, data);
    };

    scope.addEventListener('message', messageHandler);

    const readiness: ReadinessSignal = {
      isReady: (id): boolean => registry.isReady(id),
      isMismatched: (id): boolean => registry.isMismatched(id),
      ownerToken: (id): string | undefined => registry.ownerToken(id),
      // Returns the registry promise directly — simplest form. The old
      // fixed-microtask-turn invariant is dropped (ADR-0125): handshake tests
      // flush a turn budget, not an exact count, so wrapper unwrap ticks are
      // not observable.
      //
      // The window registry has no separate "gone" signal: a window teardown
      // arrives as a goodbye, which {@link createReadyClientsRegistry}
      // surfaces as `'timeout'` for backward compat. The contract reserves
      // `'gone'` for explicit owner-departed signals, which the window binding
      // can never distinguish from a plain timeout. Worker bindings do emit it.
      waitForReady: (id, timeoutMs): Promise<'ready' | 'timeout' | 'mismatch' | 'gone'> =>
        registry.waitForReady(id, timeoutMs),
      nextRequestId: (): number => registry.nextRequestId(),
    };
    this.#readiness.set(scope, readiness);
    const readinessByScope = this.#readiness;

    return {
      readiness,
      teardown(): void {
        scope.removeEventListener('message', messageHandler);
        readinessByScope.delete(scope);
      },
    };
  }
}
