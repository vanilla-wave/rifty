/**
 * Window {@link PreviewOwnerBinding} — wraps the historical
 * {@link FirstWindowOwnerResolver} + {@link createReadyClientsRegistry}
 * pair behind the binding interface.
 *
 * Owner shape: a window `Client` (the playground page hosting
 * `setupPreviewBridge`). The page sends `rifty:preview:ready` on init
 * and `rifty:preview:goodbye` on `pagehide`/teardown; the binding's
 * subscription consumes those frames.
 *
 * `resolveOwner` preserves the M10 behaviour verbatim: prefer the
 * `clientId` carried by the `FetchEvent`, fall back to the first
 * controlled window when the id is empty, warn once per scope to
 * surface the multi-window misroute risk (ADR-0031, ADR-0040).
 *
 * The `port` argument to `resolveOwner` is intentionally ignored — a
 * window owns every preview port the page registers via
 * `setupPreviewBridge`, so there is no port-keyed dispatch on the
 * window side. The {@link WorkerOwnerBinding} consumes it.
 *
 * Cited ADRs:
 * - **ADR-0031** — prefer `event.resultingClientId`/`event.clientId`.
 * - **ADR-0040** — owner-fallback rules pinned by `SW_ROUTING_VERSION`.
 * - **ADR-0046** — the binding contract this module implements.
 */

import { FirstWindowOwnerResolver, type PreviewOwnerResolver } from './owner-resolver.ts';
import type { PreviewOwnerBinding, ReadinessSubscription } from './preview-owner-binding.ts';
import { SW_PREVIEW_GOODBYE, SW_PREVIEW_READY } from './protocol.ts';
import { type ReadyClientsLogger, createReadyClientsRegistry } from './ready-clients.ts';

/**
 * Per-binding options. `resolver` lets tests swap the strategy without
 * subclassing; the default is the historical {@link FirstWindowOwnerResolver}.
 * `logger` is forwarded to {@link createReadyClientsRegistry}.
 */
export interface FirstWindowOwnerBindingOptions {
  readonly resolver?: PreviewOwnerResolver;
  readonly logger?: ReadyClientsLogger;
}

export class FirstWindowOwnerBinding implements PreviewOwnerBinding {
  readonly #resolver: PreviewOwnerResolver;
  readonly #logger: ReadyClientsLogger | undefined;

  constructor(opts: FirstWindowOwnerBindingOptions = {}) {
    this.#resolver = opts.resolver ?? new FirstWindowOwnerResolver();
    this.#logger = opts.logger;
  }

  // NOT `async` — returning the resolver's promise directly preserves the
  // single await-unwrap timing of the pre-ADR-0046 path, where
  // `route-preview` awaited `resolver.resolveOwner` with no intermediate
  // binding hop. An `async` wrapper here would add one extra microtask turn
  // (await-unwrap of the inner resolver promise), which the handshake tests
  // observe as a missed dispatch within their fixed microtask budget.
  resolveOwner(
    scope: ServiceWorkerGlobalScope,
    request: Request,
    clientId: string | null,
    _port: number,
  ): Promise<Client | null> {
    return this.#resolver.resolveOwner(scope, request, clientId);
  }

  subscribeReadiness(scope: ServiceWorkerGlobalScope): ReadinessSubscription {
    const registry =
      this.#logger !== undefined
        ? createReadyClientsRegistry(this.#logger)
        : createReadyClientsRegistry();

    const messageHandler = (event: ExtendableMessageEvent | Event): void => {
      // The binding shares the `message` listener with the legacy
      // interceptor wiring — both filter on `rifty:preview:ready` /
      // `rifty:preview:goodbye` frames keyed by `event.source.id`.
      const ev = event as ExtendableMessageEvent;
      const data = ev.data as
        | { type?: string; frameVersion?: string; routingVersion?: string }
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

    return {
      readiness: {
        isReady: (id): boolean => registry.isReady(id),
        isMismatched: (id): boolean => registry.isMismatched(id),
        // NOT `async` — returning the registry's promise directly preserves
        // the exact microtask timing of the pre-ADR-0046 path (where
        // `route-preview` awaited `registry.waitForReady` with no wrapper).
        // An `async` wrapper would insert an extra await-unwrap tick between
        // the ready frame resolving the waiter and `routePreview` resuming to
        // dispatch — observable to the handshake tests that gate dispatch on
        // a fixed number of microtask turns.
        //
        // The window registry has no separate "gone" signal — a window
        // teardown comes through as a goodbye, which {@link
        // createReadyClientsRegistry} surfaces as `'timeout'` for backward
        // compatibility. The binding contract reserves `'gone'` for explicit
        // owner-departed signals; the window binding only emits `'gone'` when
        // it can distinguish it from a plain timeout, which today is never.
        // Worker bindings do surface `'gone'`.
        waitForReady: (id, timeoutMs): Promise<'ready' | 'timeout' | 'mismatch' | 'gone'> =>
          registry.waitForReady(id, timeoutMs),
        nextRequestId: (): number => registry.nextRequestId(),
      },
      teardown(): void {
        scope.removeEventListener('message', messageHandler);
      },
    };
  }
}
