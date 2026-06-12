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
 *     routingVersion: '3',
 *     ownerToken: '...',     // page owner scope that spawned this Worker
 *     ports: [3000, 5173]   // additive optional — default []
 *   }
 *
 * Each `(ownerToken, port)` stays routable to this Worker until either the
 * Worker posts `rifty:preview:goodbye` (same `ownerToken` + `ports`, so the SW
 * knows which to drop),
 * or `scope.clients.get(workerId)` returns `undefined` at fetch time
 * (Worker terminated without sending goodbye).
 *
 * `ports` and `ownerToken` are additive optional (default `[]` / unscoped), so
 * the frame stays structurally compatible with the window-side
 * `rifty:preview:ready` shape — no `SW_FRAME_VERSION` bump per
 * ADR-0031/ADR-0040.
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
 * - ADR-0040 — `SW_FRAME_VERSION` / `SW_ROUTING_VERSION` split; `ports`
 *   and `ownerToken` are additive frame fields.
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

/** Result of resolving a copied top-level preview URL by port alone. */
export type WorkerPortOwnerResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'unique'; readonly client: Client }
  | { readonly kind: 'multiple' };

interface ReadyWaiter {
  resolve(outcome: ReadinessOutcome): void;
}

/** Per-instance to keep state from bleeding across binding instances (tests). */
interface WorkerBindingState {
  readonly ready: Set<string>;
  readonly mismatched: Set<string>;
  readonly warned: Set<string>;
  /** `${ownerToken}\0${port}` → ownerId, built from each Worker's ready frame. */
  readonly portOwners: Map<string, string>;
  /** ownerId → route keys it claimed, so goodbye can drop them precisely. */
  readonly ownerPorts: Map<string, Set<string>>;
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

function routeKey(ownerToken: string, port: number): string {
  return `${ownerToken}\0${port}`;
}

function routeKeyPort(key: string): number | null {
  const i = key.lastIndexOf('\0');
  if (i === -1) return null;
  const port = Number.parseInt(key.slice(i + 1), 10);
  return Number.isInteger(port) ? port : null;
}

function dropOwner(state: WorkerBindingState, ownerId: string): void {
  state.ready.delete(ownerId);
  const keys = state.ownerPorts.get(ownerId);
  if (keys) {
    for (const key of keys) {
      // Only drop if still ours — a fresh owner may have re-claimed the route.
      if (state.portOwners.get(key) === ownerId) {
        state.portOwners.delete(key);
      }
    }
    state.ownerPorts.delete(ownerId);
  }
}

function dropPorts(
  state: WorkerBindingState,
  ownerId: string,
  ownerToken: string,
  ports: readonly number[],
): void {
  const keys = state.ownerPorts.get(ownerId);
  if (!keys) return;
  for (const port of ports) {
    const key = routeKey(ownerToken, port);
    if (state.portOwners.get(key) === ownerId) {
      state.portOwners.delete(key);
    }
    keys.delete(key);
  }
  if (keys.size === 0) {
    state.ownerPorts.delete(ownerId);
    state.ready.delete(ownerId);
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
    ownerToken: string | null,
    port: number,
  ): Promise<Client | null> {
    const state = this.#states.get(scope);
    if (!state) return null;
    if (!ownerToken) return null;
    const ownerId = state.portOwners.get(routeKey(ownerToken, port));
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

  /**
   * Which live Workers claim `port` across ALL owner tokens — the
   * copied-top-level fast path (ADR-0125). `'unique'` carries the only live
   * claimant; `'multiple'` = ambiguous, caller refuses (503); `'none'` = fall
   * back to window resolution. Side effect: dead claimants are dropped and
   * their in-flight `waitForReady` waiters resolve `'gone'`.
   */
  async resolvePortOwners(
    scope: ServiceWorkerGlobalScope,
    port: number,
  ): Promise<WorkerPortOwnerResolution> {
    const state = this.#states.get(scope);
    if (!state) return { kind: 'none' };
    const candidateIds = new Set<string>();
    for (const [key, ownerId] of state.portOwners) {
      if (routeKeyPort(key) === port) candidateIds.add(ownerId);
    }
    const live: Client[] = [];
    for (const ownerId of candidateIds) {
      const client = (await scope.clients.get(ownerId)) ?? null;
      if (client) {
        live.push(client as Client);
      } else {
        dropOwner(state, ownerId);
        resolveWaiters(state, ownerId, 'gone');
      }
    }
    if (live.length === 0) return { kind: 'none' };
    if (live.length === 1) return { kind: 'unique', client: live[0]! };
    return { kind: 'multiple' };
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
            ownerToken?: string;
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
      const ownerToken =
        typeof data.ownerToken === 'string' && data.ownerToken.length > 0 ? data.ownerToken : null;
      if (data.type === SW_PREVIEW_READY) {
        state.ready.add(sourceId);
        if (ownerToken && ports.length > 0) {
          const owned = state.ownerPorts.get(sourceId) ?? new Set<string>();
          for (const port of ports) {
            const key = routeKey(ownerToken, port);
            state.portOwners.set(key, sourceId);
            owned.add(key);
          }
          state.ownerPorts.set(sourceId, owned);
        }
        resolveWaiters(state, sourceId, 'ready');
      } else {
        // Goodbye: resolve pending waiters `'gone'` once the owner has no
        // claimed ports left, so in-flight requests clear at once without
        // breaking partial port teardown.
        if (ownerToken && ports.length > 0) {
          dropPorts(state, sourceId, ownerToken, ports);
        } else {
          dropOwner(state, sourceId);
        }
        if (!state.ready.has(sourceId)) {
          resolveWaiters(state, sourceId, 'gone');
        }
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
