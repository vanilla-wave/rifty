/**
 * Default preview owner binding: prefer Worker owners that explicitly claim a
 * port, fall back to the historical window bridge otherwise.
 *
 * Real Vite runs in a Worker and posts `ports: [...]`, so `/preview/<port>`
 * can route SW -> Worker directly. Legacy page-owned dev mode posts no ports,
 * so it keeps the FirstWindowOwnerBinding path.
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

export interface PortAwareOwnerBindingOptions {
  readonly window?: FirstWindowOwnerBindingOptions;
  readonly worker?: WorkerOwnerBindingOptions;
}

export class PortAwareOwnerBinding implements PreviewOwnerBinding {
  readonly #window: PreviewOwnerBinding;
  readonly #worker: PreviewOwnerBinding;
  readonly #ownerKinds = new Map<string, OwnerKind>();

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
    const worker = await this.#worker.resolveOwner(scope, request, clientId, port);
    if (worker) {
      this.#ownerKinds.set(worker.id, 'worker');
      return worker;
    }
    const window = await this.#window.resolveOwner(scope, request, clientId, port);
    if (window) {
      if ('type' in window && window.type !== 'window') return null;
      this.#ownerKinds.set(window.id, 'window');
    }
    return window;
  }

  subscribeReadiness(scope: ServiceWorkerGlobalScope): ReadinessSubscription {
    const workerSub = this.#worker.subscribeReadiness(scope);
    const windowSub = this.#window.subscribeReadiness(scope);
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
      waitForReady: async (id, timeoutMs): Promise<ReadinessOutcome> => {
        const signal = pick(id);
        if (signal) return signal.waitForReady(id, timeoutMs);
        if (workerSub.readiness.isMismatched(id) || windowSub.readiness.isMismatched(id)) {
          return 'mismatch';
        }
        if (workerSub.readiness.isReady(id) || windowSub.readiness.isReady(id)) {
          return 'ready';
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
      teardown(): void {
        workerSub.teardown();
        windowSub.teardown();
        ownerKinds.clear();
      },
    };
  }
}
