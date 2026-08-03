/**
 * Event-loop keepalive for run-to-completion child realms
 * ADR-0152. A libuv-style refcount of handles that keep the
 * loop alive (timers/immediates/pending dynamic imports). `awaitDrain` resolves
 * once the count hits zero — the kernel drain seam (ADR-0039) awaits it before
 * reaping, so a child exits on "loop empty" like Node, not at top-level resolve.
 *
 * Loud-fail (no silent stub): a recorded `unhandledrejection` rejects the drain
 * (→ kernel stderr + exit 1); a never-draining loop rejects with a
 * self-explanatory cap error rather than hanging the worker forever. The cap is
 * a SAFETY-NET, not a faithfulness feature (Node has no cap) — generous + loud +
 * documented (see ADR + compat matrix).
 */

import { setKernelDrainHook } from '@riftydev/kernel';

interface KeepaliveState {
  refCount: number;
  rejection: { reason: unknown } | null;
  readonly hostSetTimeout: typeof globalThis.setTimeout;
}

const KEEPALIVE_STATE = Symbol.for('rifty.runtime-js.event-loop-keepalive.v1');

function keepaliveState(): KeepaliveState {
  const realm = globalThis as typeof globalThis & { [KEEPALIVE_STATE]?: KeepaliveState };
  if (realm[KEEPALIVE_STATE] === undefined) {
    Object.defineProperty(realm, KEEPALIVE_STATE, {
      value: {
        refCount: 0,
        rejection: null,
        // awaitDrain MUST use the host timer, not installTimerGlobals' ref-counted
        // wrapper. Store the first bundle's capture on the realm so later
        // node-entry chunks share both the counter and the original timer.
        hostSetTimeout: globalThis.setTimeout.bind(globalThis),
      } satisfies KeepaliveState,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }
  return realm[KEEPALIVE_STATE] as KeepaliveState;
}

/** Increment the active-handle count (timer/immediate/import scheduled). */
export function ref(): void {
  keepaliveState().refCount += 1;
}

/** Decrement the active-handle count (handle fired/cleared/settled). Floors at 0. */
export function unref(): void {
  const state = keepaliveState();
  if (state.refCount > 0) state.refCount -= 1;
}

/** Current active-handle count. */
export function activeRefs(): number {
  return keepaliveState().refCount;
}

/** Record the first unhandled rejection so `awaitDrain` surfaces it loudly. */
export function recordRejection(reason: unknown): void {
  const state = keepaliveState();
  if (state.rejection === null) state.rejection = { reason };
}

/**
 * Track a detached async task as an event-loop handle. Some real CLIs start an
 * async action without awaiting it at top level (Vite's bundled CAC does this);
 * Node stays alive because the action uses libuv-backed work. Browser/WASI
 * promises may not create such handles, so we pin the child until the promise
 * settles and surface rejection through awaitDrain.
 */
export function trackKeepalivePromise(promise: PromiseLike<unknown>): void {
  ref();
  promise.then(
    () => unref(),
    (err) => {
      unref();
      recordRejection(err);
    },
  );
}

/** Test-only: reset module state between cases. */
export function resetKeepalive(): void {
  const state = keepaliveState();
  state.refCount = 0;
  state.rejection = null;
}

/** Generous default cap — a safety-net against a genuine hang/leak, not Node parity. */
export const DEFAULT_DRAIN_CAP_MS = 30_000;

export interface DrainOptions {
  capMs?: number;
  /** Schedule a check on the MACROTASK queue (seam for tests; defaults to setTimeout 0). */
  scheduleMacrotask?: (cb: () => void) => void;
  /** Monotonic clock (seam for tests; defaults to performance.now). */
  now?: () => number;
}

/**
 * Resolve once the event loop has drained (refCount→0), reject on a recorded
 * rejection or once `capMs` elapses without draining.
 *
 * The first check runs on the MACROTASK queue so all pending microtasks (e.g. a
 * detached `import(...).then(run)` chain whose loader reads are microtask-driven)
 * complete before refCount is first sampled — that is what makes the prettier-
 * class detached promise reach `run()` before the realm is reaped.
 */
export function awaitDrain(opts: DrainOptions = {}): Promise<void> {
  const capMs = opts.capMs ?? DEFAULT_DRAIN_CAP_MS;
  const schedule =
    opts.scheduleMacrotask ??
    ((cb: () => void) => {
      keepaliveState().hostSetTimeout(cb, 0);
    });
  const now = opts.now ?? (() => performance.now());
  const start = now();
  return new Promise<void>((resolve, reject) => {
    const tick = (): void => {
      const state = keepaliveState();
      if (state.rejection !== null) {
        const r = state.rejection.reason;
        reject(r instanceof Error ? r : new Error(String(r)));
        return;
      }
      if (state.refCount <= 0) {
        // TODO(backlog: runtime-js/late-unhandled-rejection-drain): cover a late
        // browser unhandledrejection task without a second drain owner.
        resolve();
        return;
      }
      if (now() - start > capMs) {
        reject(
          new Error(
            `child realm exceeded keepalive drain cap (${capMs}ms) — suspected hang or leaked handle (${state.refCount} active ref(s))`,
          ),
        );
        return;
      }
      schedule(tick);
    };
    schedule(tick);
  });
}

interface RejectionEventLike {
  reason: unknown;
}
interface RejectionTarget {
  addEventListener(type: 'unhandledrejection', cb: (ev: RejectionEventLike) => void): void;
}

/**
 * Trap async unhandled rejections in the worker realm. A try/catch around the
 * entry CANNOT see an async rejection (it's not thrown synchronously); this
 * listener is the only way to make a detached `promise.then` that rejects fail
 * LOUDLY.
 *
 * Record-not-swallow: we record the reason so `awaitDrain` rejects with it
 * (→ kernel stderr + exit 1 for run-to-completion children). We deliberately do
 * NOT call `preventDefault` — the browser's default reporting still fires in
 * every realm, including the long-lived owner (serve:true) whose drain is never
 * awaited. Calling `preventDefault` on the owner would silently swallow async
 * rejections, violating the loud-fail Fidelity rule.
 */
export function installUnhandledRejectionTrap(
  target: RejectionTarget = self as unknown as RejectionTarget,
): void {
  target.addEventListener('unhandledrejection', (ev: RejectionEventLike) => {
    recordRejection(ev.reason);
  });
}

/**
 * Install the full keepalive surface in a worker realm: the unhandledrejection
 * trap + register the kernel drain hook (the kernel awaits it for
 * run-to-completion children only). Call once during the worker bootstrap,
 * alongside the process-shim install.
 */
export function installEventLoopKeepalive(): void {
  installUnhandledRejectionTrap();
  setKernelDrainHook(() => awaitDrain());
}
