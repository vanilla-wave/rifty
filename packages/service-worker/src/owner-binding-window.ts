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
 * id is empty, and warn once per scope for the multi-window misroute risk.
 *
 * Window now routes by `port` for falsy-clientId preview traffic (ADR-0160): a
 * unique ready window that advertised the port wins; multiple ready windows for
 * the same port -> 503 isolation (symmetric with the worker `(ownerToken, port)`
 * scoping). A window advertising NO ports keeps the legacy ready-window fallback
 * — for no-clientId preview traffic (`''`/`null` sentinels) the binding prefers
 * an already-ready window over an unready first match (ADR-0031, ADR-0040,
 * ADR-0125).
 *
 * Anti-hijack (ADR-0160): a previewed app's window is a SW-served preview
 * document; its `rifty:preview:ready`/`goodbye` frames are rejected (via
 * `isUntrustedSource`) so it cannot claim the bridge. Keyed on the SW-served-nav
 * fact, not `client.url`, so `history.pushState` cannot defeat it.
 *
 * - ADR-0031 — prefer `event.resultingClientId`/`event.clientId`.
 * - ADR-0040 — owner-fallback rules pinned by `SW_ROUTING_VERSION`.
 * - ADR-0125 — the binding contract this module implements (supersedes ADR-0046).
 * - ADR-0160 — window port-keying for falsy-clientId traffic + anti-hijack.
 */

import { FirstWindowOwnerResolver, type PreviewOwnerResolver } from './owner-resolver.ts';
import type {
  PreviewOwnerBinding,
  ReadinessSignal,
  ReadinessSubscription,
} from './preview-owner-binding.ts';
import { SW_PREVIEW_GOODBYE, SW_PREVIEW_READY } from './protocol.ts';
import {
  type ReadyClientsLogger,
  type ReadyClientsRegistry,
  createReadyClientsRegistry,
} from './ready-clients.ts';

/**
 * Per-binding options. `resolver` lets tests swap the strategy without
 * subclassing (default {@link FirstWindowOwnerResolver}); `logger` is
 * forwarded to {@link createReadyClientsRegistry}. `isUntrustedSource`
 * (ADR-0160) rejects ready/goodbye frames from SW-served preview-document
 * clients so a previewed app cannot hijack the bridge.
 */
export interface FirstWindowOwnerBindingOptions {
  readonly resolver?: PreviewOwnerResolver;
  readonly logger?: ReadyClientsLogger;
  readonly isUntrustedSource?: (id: string) => boolean;
}

export class FirstWindowOwnerBinding implements PreviewOwnerBinding {
  readonly #resolver: PreviewOwnerResolver;
  readonly #logger: ReadyClientsLogger | undefined;
  readonly #isUntrustedSource: ((id: string) => boolean) | undefined;
  readonly #readiness = new WeakMap<ServiceWorkerGlobalScope, ReadinessSignal>();
  readonly #registries = new WeakMap<ServiceWorkerGlobalScope, ReadyClientsRegistry>();

  constructor(opts: FirstWindowOwnerBindingOptions = {}) {
    this.#resolver = opts.resolver ?? new FirstWindowOwnerResolver();
    this.#logger = opts.logger;
    this.#isUntrustedSource = opts.isUntrustedSource;
  }

  async resolveOwner(
    scope: ServiceWorkerGlobalScope,
    request: Request,
    clientId: string | null,
    port: number,
  ): Promise<Client | null> {
    const owner = await this.#resolver.resolveOwner(scope, request, clientId);
    if (clientId || !owner) return owner; // real id -> direct; or none at all
    // ADR-0160: port-key falsy-clientId preview traffic to the window owning it.
    const portRes = await this.#resolvePortWindows(scope, port);
    if (portRes.kind === 'unique') return portRes.client;
    if (portRes.kind === 'multiple') return null; // ambiguous -> 503 (ADR-0123 isolation, now windows)
    // 'none' -> legacy ready-preferring fallback (no-ports windows).
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

  // ADR-0160: which ready windows advertised `port`. 'unique' carries the only
  // live one; 'multiple' = ambiguous (503); 'none' = no port-keyed owner ->
  // legacy fallback.
  async #resolvePortWindows(
    scope: ServiceWorkerGlobalScope,
    port: number,
  ): Promise<{ kind: 'none' } | { kind: 'unique'; client: Client } | { kind: 'multiple' }> {
    const registry = this.#registries.get(scope);
    if (!registry) return { kind: 'none' };
    const ids = registry.readyOwnersOfPort(port);
    if (ids.length === 0) return { kind: 'none' };
    const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: false });
    const byId = new Map(windows.map((w) => [w.id, w] as const));
    const live = ids
      .map((id) => byId.get(id))
      .filter((c): c is WindowClient => !!c && (!('type' in c) || c.type === 'window'));
    if (live.length === 0) return { kind: 'none' };
    if (live.length === 1) return { kind: 'unique', client: live[0]! };
    return { kind: 'multiple' };
  }

  subscribeReadiness(scope: ServiceWorkerGlobalScope): ReadinessSubscription {
    const registry =
      this.#logger !== undefined
        ? createReadyClientsRegistry(this.#logger)
        : createReadyClientsRegistry();
    this.#registries.set(scope, registry);
    // Warn-once-per-source for the anti-hijack rejection (ADR-0160).
    const authWarned = new Set<string>();
    const logger = this.#logger;

    const messageHandler = (event: ExtendableMessageEvent | Event): void => {
      // Shares the `message` listener with the legacy interceptor wiring —
      // both filter ready/goodbye frames keyed by `event.source.id`.
      const ev = event as ExtendableMessageEvent;
      const data = ev.data as
        | {
            type?: string;
            frameVersion?: string;
            routingVersion?: string;
            ownerToken?: string;
            ports?: number[];
          }
        | null
        | undefined;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (data.type !== SW_PREVIEW_READY && data.type !== SW_PREVIEW_GOODBYE) return;
      const source = ev.source as Client | null;
      const sourceId = source && 'id' in source ? source.id : null;
      if (!sourceId) return;
      // ADR-0160 anti-hijack: reject ready AND goodbye from SW-served
      // preview-document clients — a previewed app must not claim the bridge.
      if (this.#isUntrustedSource?.(sourceId)) {
        if (!authWarned.has(sourceId)) {
          authWarned.add(sourceId);
          logger?.warn(
            `[rifty/service-worker] rejected preview handshake from preview-document client ${sourceId} (anti-hijack)`,
          );
        }
        return;
      }
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
    const registriesByScope = this.#registries;

    return {
      readiness,
      teardown(): void {
        scope.removeEventListener('message', messageHandler);
        readinessByScope.delete(scope);
        registriesByScope.delete(scope);
      },
    };
  }
}
