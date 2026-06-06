/**
 * Worker {@link PreviewOwnerBinding} (A-023: SW→Worker direct routing),
 * on top of ADR-0043's cross-realm preview bridge.
 *
 * Owner shape: a `Client` of `type === 'worker'` hosting a Real-Vite-style
 * preview port. The Worker announces itself with an extended
 * `rifty:preview:ready` frame:
 *
 *   {
 *     type: 'rifty:preview:ready',
 *     frameVersion: '1',
 *     routingVersion: '1',
 *     ports: [3000, 5173]   // additive optional — default []
 *   }
 *
 * Each port stays routable to this Worker until either the Worker posts
 * `rifty:preview:goodbye` (same `ports`, so the SW knows which to drop),
 * or `scope.clients.get(workerId)` returns `undefined` at fetch time
 * (Worker terminated without sending goodbye).
 *
 * `ports` is additive optional (default `[]`) so the frame stays
 * structurally compatible with the window-side `rifty:preview:ready`
 * shape — no `SW_FRAME_VERSION` bump per ADR-0031/ADR-0040.
 *
 * Lifecycle differences from the window binding:
 *  - No `pagehide` (Workers have no document): the SW relies on the
 *    Worker's goodbye plus the lazy `clients.get(id) === undefined` check
 *    at fetch time — the trap Q-2026-05-27-002 warned about; handled by
 *    re-validating the owner before returning it.
 *  - No `controllerchange`: if the parent that spawned the Worker reloads,
 *    the owning process is gone and `clients.get` returns undefined.
 *  - In-flight waiters: if `resolveOwner` finds the Worker gone, pending
 *    `waitForReady` resolves `'gone'` (not `'timeout'`) for a precise 503.
 *
 * Cited ADRs:
 * - ADR-0011 — sync IPC + worker-as-process; provides `Client.type === 'worker'`.
 * - ADR-0017 — `@riftydev/net` cross-realm bridge; `ports` mirrors the
 *   Worker's `serveCrossRealmPreview(port, …)` registrations.
 * - ADR-0040 — `SW_FRAME_VERSION` / `SW_ROUTING_VERSION` split; `ports` additive.
 * - ADR-0043 — Vite-in-Worker; §"Follow-ups" called for this binding.
 * - ADR-0046 — the binding contract this module implements.
 */

import type {
  PreviewOwnerBinding,
  ReadinessOutcome,
  ReadinessSignal,
  ReadinessSubscription,
} from './preview-owner-binding.ts';
import {
  SW_FRAME_VERSION,
  SW_PREVIEW_GOODBYE,
  SW_PREVIEW_READY,
  SW_ROUTING_VERSION,
} from './protocol.ts';

export interface WorkerOwnerBindingLogger {
  warn(message: string): void;
}

const defaultLogger: WorkerOwnerBindingLogger = {
  warn(msg: string): void {
    // eslint-disable-next-line no-console
    console.warn(msg);
  },
};

export interface WorkerOwnerBindingOptions {
  /** Warn path for protocol-version drift / unowned-port lookup. Defaults to `console.warn`. */
  readonly logger?: WorkerOwnerBindingLogger;
}

interface ReadyWaiter {
  resolve(outcome: ReadinessOutcome): void;
}

/** Per-instance to keep state from bleeding across binding instances (tests). */
interface WorkerBindingState {
  readonly ready: Set<string>;
  readonly mismatched: Set<string>;
  readonly warned: Set<string>;
  /** port → ownerId, built from each Worker's ready frame. */
  readonly portOwners: Map<number, string>;
  /** ownerId → ports it claimed, so goodbye can drop them precisely. */
  readonly ownerPorts: Map<string, Set<number>>;
  readonly waiters: Map<string, Set<ReadyWaiter>>;
  requestIdCounter: number;
}

function createState(): WorkerBindingState {
  return {
    ready: new Set(),
    mismatched: new Set(),
    warned: new Set(),
    portOwners: new Map(),
    ownerPorts: new Map(),
    waiters: new Map(),
    requestIdCounter: 1,
  };
}

function resolveWaiters(
  state: WorkerBindingState,
  ownerId: string,
  outcome: ReadinessOutcome,
): void {
  const set = state.waiters.get(ownerId);
  if (!set) return;
  for (const w of set) w.resolve(outcome);
  state.waiters.delete(ownerId);
}

function dropOwner(state: WorkerBindingState, ownerId: string): void {
  state.ready.delete(ownerId);
  const ports = state.ownerPorts.get(ownerId);
  if (ports) {
    for (const port of ports) {
      // Only drop if still ours — a fresh owner may have re-claimed the port.
      if (state.portOwners.get(port) === ownerId) {
        state.portOwners.delete(port);
      }
    }
    state.ownerPorts.delete(ownerId);
  }
}

export class WorkerOwnerBinding implements PreviewOwnerBinding {
  readonly #logger: WorkerOwnerBindingLogger;
  readonly #states = new WeakMap<ServiceWorkerGlobalScope, WorkerBindingState>();

  constructor(opts: WorkerOwnerBindingOptions = {}) {
    this.#logger = opts.logger ?? defaultLogger;
  }

  async resolveOwner(
    scope: ServiceWorkerGlobalScope,
    _request: Request,
    _clientId: string | null,
    port: number,
  ): Promise<Client | null> {
    const state = this.#states.get(scope);
    if (!state) return null;
    const ownerId = state.portOwners.get(port);
    if (!ownerId) return null;
    const client = (await scope.clients.get(ownerId)) ?? null;
    if (!client) {
      // Worker terminated without goodbye: drop the stale mapping and
      // resolve pending waiters with `'gone'` for a precise 503.
      dropOwner(state, ownerId);
      resolveWaiters(state, ownerId, 'gone');
      return null;
    }
    return client as Client;
  }

  subscribeReadiness(scope: ServiceWorkerGlobalScope): ReadinessSubscription {
    const state = createState();
    this.#states.set(scope, state);

    const handleMessage = (event: ExtendableMessageEvent | Event): void => {
      const ev = event as ExtendableMessageEvent;
      const data = ev.data as
        | {
            type?: string;
            frameVersion?: string;
            routingVersion?: string;
            ports?: number[];
          }
        | null
        | undefined;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (data.type !== SW_PREVIEW_READY && data.type !== SW_PREVIEW_GOODBYE) return;
      const source = ev.source as Client | null;
      const sourceId = source && 'id' in source ? source.id : null;
      if (!sourceId) return;
      // Only `type === 'worker'` sources, else a window posting the
      // worker-shape frame would be erroneously claimed.
      if (source && 'type' in source && source.type !== 'worker') return;

      const frameOk = data.frameVersion === SW_FRAME_VERSION;
      const routingOk = data.routingVersion === SW_ROUTING_VERSION;
      if (!frameOk || !routingOk) {
        if (!state.warned.has(sourceId)) {
          state.warned.add(sourceId);
          const drifted: string[] = [];
          if (!frameOk) drifted.push('frame');
          if (!routingOk) drifted.push('routing');
          this.#logger.warn(
            `[rifty/service-worker] worker preview protocol mismatch from ${sourceId} (${drifted.join(
              '+',
            )}): got frame=${String(data.frameVersion)} routing=${String(
              data.routingVersion,
            )}, want frame=${SW_FRAME_VERSION} routing=${SW_ROUTING_VERSION}`,
          );
        }
        state.mismatched.add(sourceId);
        resolveWaiters(state, sourceId, 'mismatch');
        return;
      }

      const ports = Array.isArray(data.ports) ? data.ports.filter((p) => Number.isInteger(p)) : [];
      if (data.type === SW_PREVIEW_READY) {
        state.ready.add(sourceId);
        if (ports.length > 0) {
          const owned = state.ownerPorts.get(sourceId) ?? new Set<number>();
          for (const port of ports) {
            state.portOwners.set(port, sourceId);
            owned.add(port);
          }
          state.ownerPorts.set(sourceId, owned);
        }
        resolveWaiters(state, sourceId, 'ready');
      } else {
        // Goodbye: resolve pending waiters `'gone'` so in-flight requests clear at once.
        dropOwner(state, sourceId);
        resolveWaiters(state, sourceId, 'gone');
      }
    };

    scope.addEventListener('message', handleMessage);

    const readiness: ReadinessSignal = {
      isReady: (id): boolean => state.ready.has(id),
      isMismatched: (id): boolean => state.mismatched.has(id),
      waitForReady(id, timeoutMs): Promise<ReadinessOutcome> {
        if (state.mismatched.has(id)) return Promise.resolve('mismatch');
        if (state.ready.has(id)) return Promise.resolve('ready');
        return new Promise<ReadinessOutcome>((resolve) => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const waiter: ReadyWaiter = {
            resolve(outcome): void {
              if (timer !== null) clearTimeout(timer);
              resolve(outcome);
            },
          };
          const set = state.waiters.get(id) ?? new Set<ReadyWaiter>();
          set.add(waiter);
          state.waiters.set(id, set);
          timer = setTimeout(() => {
            const s = state.waiters.get(id);
            if (s) {
              s.delete(waiter);
              if (s.size === 0) state.waiters.delete(id);
            }
            resolve('timeout');
          }, timeoutMs);
        });
      },
      nextRequestId: (): number => state.requestIdCounter++,
    };

    return {
      readiness,
      teardown: (): void => {
        scope.removeEventListener('message', handleMessage);
        this.#states.delete(scope);
      },
    };
  }
}
