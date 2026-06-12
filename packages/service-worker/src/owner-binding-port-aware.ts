/**
 * Default preview owner binding: resolve the controlling window first, then
 * prefer a Worker that claims the requested port within that window's owner
 * token. Fall back to the historical window bridge otherwise.
 *
 * Embedded iframe traffic arrives as the `''` sentinel (ADR-0125) and always
 * takes the window -> ownerToken path. A copied top-level `/preview/<port>/`
 * URL has no controlling playground window token and arrives as `null`; only
 * then may the binding route directly to a Worker when exactly one live Worker
 * claims the port. Ambiguous same-port Worker owners return 503 before window
 * fallback to preserve ADR-0123 multi-window isolation.
 *
 * Real Vite runs in a Worker and posts `{ ownerToken, ports: [...] }`, so
 * `/preview/<port>` can route SW -> Worker directly without letting a Worker
 * from another playground tab steal the same port. Legacy page-owned dev mode
 * posts no owner token, so it keeps the FirstWindowOwnerBinding path.
 */

import {
  FirstWindowOwnerBinding,
  type FirstWindowOwnerBindingOptions,
} from './owner-binding-window.ts';
import { WorkerOwnerBinding, type WorkerOwnerBindingOptions } from './owner-binding-worker.ts';
import type {
  PreviewOwnerBinding,
  ReadinessOutcome,
  ReadinessSignal,
  ReadinessSubscription,
} from './preview-owner-binding.ts';

type OwnerKind = 'worker' | 'window';

interface ScopeSignals {
  readonly worker: ReadinessSignal;
  readonly window: ReadinessSignal;
}

export interface PortAwareOwnerBindingOptions {
  readonly window?: FirstWindowOwnerBindingOptions;
  readonly worker?: WorkerOwnerBindingOptions;
}

export class PortAwareOwnerBinding implements PreviewOwnerBinding {
  readonly #window: FirstWindowOwnerBinding;
  readonly #worker: WorkerOwnerBinding;
  readonly #ownerKinds = new Map<string, OwnerKind>();
  readonly #signals = new WeakMap<ServiceWorkerGlobalScope, ScopeSignals>();

  constructor(opts: PortAwareOwnerBindingOptions = {}) {
    this.#window = new FirstWindowOwnerBinding(opts.window);
    this.#worker = new WorkerOwnerBinding(opts.worker);
  }

  async resolveOwner(
    scope: ServiceWorkerGlobalScope,
    request: Request,
    clientId: string | null,
    port: number,
  ): Promise<Client | null> {
    if (clientId === null) {
      const portOwners = await this.#worker.resolvePortOwners(scope, port);
      if (portOwners.kind === 'multiple') return null;
      if (portOwners.kind === 'unique') {
        this.#ownerKinds.set(portOwners.client.id, 'worker');
        return portOwners.client;
      }
    }
    const resolvedWindow = await this.#window.resolveOwner(scope, request, clientId, port);
    const window =
      resolvedWindow && 'type' in resolvedWindow && resolvedWindow.type !== 'window'
        ? null
        : resolvedWindow;
    if (window) {
      this.#ownerKinds.set(window.id, 'window');
      const ownerToken = this.#signals.get(scope)?.window.ownerToken?.(window.id);
      if (ownerToken) {
        const worker = await this.#worker.resolveOwner(scope, request, ownerToken, port);
        if (worker) {
          this.#ownerKinds.set(worker.id, 'worker');
          return worker;
        }
      }
    }
    return window;
  }

  subscribeReadiness(scope: ServiceWorkerGlobalScope): ReadinessSubscription {
    const workerSub = this.#worker.subscribeReadiness(scope);
    const windowSub = this.#window.subscribeReadiness(scope);
    this.#signals.set(scope, { worker: workerSub.readiness, window: windowSub.readiness });
    const ownerKinds = this.#ownerKinds;
    let requestIdCounter = 1;

    const pick = (id: string): ReadinessSignal | null => {
      const kind = this.#ownerKinds.get(id);
      if (kind === 'worker') return workerSub.readiness;
      if (kind === 'window') return windowSub.readiness;
      return null;
    };

    const readiness: ReadinessSignal = {
      isReady: (id): boolean => {
        const signal = pick(id);
        return signal
          ? signal.isReady(id)
          : workerSub.readiness.isReady(id) || windowSub.readiness.isReady(id);
      },
      isMismatched: (id): boolean => {
        const signal = pick(id);
        return signal
          ? signal.isMismatched(id)
          : workerSub.readiness.isMismatched(id) || windowSub.readiness.isMismatched(id);
      },
      ownerToken: (id): string | undefined =>
        workerSub.readiness.ownerToken?.(id) ?? windowSub.readiness.ownerToken?.(id),
      waitForReady(id, timeoutMs): Promise<ReadinessOutcome> {
        const signal = pick(id);
        if (signal) return signal.waitForReady(id, timeoutMs);
        if (workerSub.readiness.isMismatched(id) || windowSub.readiness.isMismatched(id)) {
          return Promise.resolve('mismatch');
        }
        if (workerSub.readiness.isReady(id) || windowSub.readiness.isReady(id)) {
          return Promise.resolve('ready');
        }
        return Promise.race([
          workerSub.readiness.waitForReady(id, timeoutMs),
          windowSub.readiness.waitForReady(id, timeoutMs),
        ]);
      },
      nextRequestId: (): number => requestIdCounter++,
    };

    return {
      readiness,
      teardown: (): void => {
        workerSub.teardown();
        windowSub.teardown();
        this.#signals.delete(scope);
        ownerKinds.clear();
      },
    };
  }
}
