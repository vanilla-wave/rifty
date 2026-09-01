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

const PromiseConstructorPrimordial = Promise;
const promiseResolvePrimordial = Promise.resolve;
const promiseThenPrimordial = Promise.prototype.then;
const reflectApplyPrimordial = Reflect.apply;

interface KeepaliveState {
  refCount: number;
  rejection: { reason: unknown; origin: NodeEvalTerminalOrigin } | null;
  nodeEvalLifecycle: NodeEvalLifecycleRecord | null;
  nodeEvalDrainOwner: object | null;
  nodeEvalDirectTerminalPending: boolean;
  readonly hostSetTimeout: typeof globalThis.setTimeout;
}

export interface NodeEvalDrainLifecycle {
  beforeExit(): void | Promise<void>;
  projectUnhandled(reason: unknown, origin: NodeEvalUnhandledOrigin): unknown;
  terminateUnhandled(reason: unknown, origin: NodeEvalTerminationOrigin): unknown;
}

export type NodeEvalUnhandledOrigin = 'rejection' | 'uncaught-error';
export type NodeEvalTerminationOrigin = NodeEvalUnhandledOrigin | 'lifecycle-failure';
type NodeEvalTerminalOrigin = NodeEvalUnhandledOrigin | 'explicit-exit';

interface NodeEvalLifecycleRecord {
  readonly lifecycle: NodeEvalDrainLifecycle;
  flush: Promise<void> | null;
  terminalClaimed: boolean;
  pendingTerminal: NodeEvalPendingTerminal | null;
}

type NodeEvalPendingTerminal =
  | {
      readonly kind: 'explicit-exit';
      readonly reason: unknown;
      readonly onFlushed: () => unknown;
    }
  | {
      readonly kind: 'unhandled';
      readonly reason: unknown;
      readonly origin: NodeEvalUnhandledOrigin;
    };

const KEEPALIVE_STATE = Symbol.for('rifty.runtime-js.event-loop-keepalive.v1');

function keepaliveState(): KeepaliveState {
  const realm = globalThis as typeof globalThis & { [KEEPALIVE_STATE]?: KeepaliveState };
  if (realm[KEEPALIVE_STATE] === undefined) {
    Object.defineProperty(realm, KEEPALIVE_STATE, {
      value: {
        refCount: 0,
        rejection: null,
        nodeEvalLifecycle: null,
        nodeEvalDrainOwner: null,
        nodeEvalDirectTerminalPending: false,
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

/** Capture native scheduling before a Worker replaces global timer functions. */
export function initializeEventLoopKeepalive(): void {
  keepaliveState();
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
export function recordRejection(
  reason: unknown,
  origin: NodeEvalUnhandledOrigin = 'rejection',
): void {
  if (beginNodeEvalUnhandled(reason, origin)) return;
  const state = keepaliveState();
  if (state.rejection === null) state.rejection = { reason, origin };
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

/** Install the one eval invocation's deferred print/error work into the existing drain. */
export function registerNodeEvalDrainLifecycle(lifecycle: NodeEvalDrainLifecycle): void {
  const state = keepaliveState();
  if (state.nodeEvalLifecycle !== null) {
    throw new Error('node eval drain lifecycle is already registered');
  }
  state.nodeEvalLifecycle = {
    lifecycle,
    flush: null,
    terminalClaimed: false,
    pendingTerminal: null,
  };
}

function flushNodeEvalDrainLifecycle(record: NodeEvalLifecycleRecord): Promise<void> {
  if (record.flush !== null) return record.flush;
  const state = keepaliveState();
  let resolveFlush!: () => void;
  let rejectFlush!: (reason: unknown) => void;
  const flush = new PromiseConstructorPrimordial<void>((resolve, reject) => {
    resolveFlush = resolve;
    rejectFlush = reject;
  });
  record.flush = flush;
  const clear = (): void => {
    if (state.nodeEvalLifecycle === record) state.nodeEvalLifecycle = null;
  };
  let beforeExit: void | Promise<void>;
  try {
    beforeExit = record.lifecycle.beforeExit();
  } catch (error) {
    clear();
    rejectFlush(error);
    return flush;
  }
  let settled: Promise<void>;
  try {
    settled = reflectApplyPrimordial(promiseResolvePrimordial, PromiseConstructorPrimordial, [
      beforeExit,
    ]) as Promise<void>;
  } catch (error) {
    clear();
    rejectFlush(error);
    return flush;
  }
  void reflectApplyPrimordial(promiseThenPrimordial, settled, [
    () => {
      clear();
      resolveFlush();
    },
    (error: unknown) => {
      clear();
      rejectFlush(error);
    },
  ]);
  return flush;
}

/**
 * Own a post-evaluation `process.exit`: the active drain flushes + rejects with
 * the exit sentinel, while a served/no-drain eval flushes before its caller
 * sends the physical exit control.
 */
export function beginNodeEvalExplicitExit(reason: unknown, onFlushed: () => unknown): boolean {
  const state = keepaliveState();
  const record = state.nodeEvalLifecycle;
  if (record === null) return false;
  if (record.terminalClaimed) return true;
  record.terminalClaimed = true;
  const pending = { kind: 'explicit-exit', reason, onFlushed } satisfies NodeEvalPendingTerminal;
  record.pendingTerminal = pending;
  state.rejection = { reason, origin: 'explicit-exit' };
  if (state.nodeEvalDrainOwner !== null) return true;
  completeNodeEvalTerminalWithoutDrain(state, record, pending);
  return true;
}

function completeNodeEvalTerminalWithoutDrain(
  state: KeepaliveState,
  record: NodeEvalLifecycleRecord,
  pending: NodeEvalPendingTerminal,
): void {
  if (state.nodeEvalDirectTerminalPending) return;
  state.nodeEvalDirectTerminalPending = true;
  const flush = flushNodeEvalDrainLifecycle(record);
  void reflectApplyPrimordial(promiseThenPrimordial, flush, [
    () => {
      if (pending.kind === 'explicit-exit') {
        try {
          const terminal = pending.onFlushed();
          if (!isRiftyProcessExit(terminal)) {
            throw new Error('node eval explicit exit callback did not terminate the process');
          }
          state.rejection = { reason: terminal, origin: 'explicit-exit' };
        } catch (error) {
          terminateNodeEvalWithoutDrain(state, record, error, 'lifecycle-failure');
        }
        return;
      }
      terminateNodeEvalWithoutDrain(state, record, pending.reason, pending.origin);
    },
    (error: unknown) => terminateNodeEvalWithoutDrain(state, record, error, 'lifecycle-failure'),
  ]);
}

function throwOutsideLifecycle(error: unknown): void {
  keepaliveState().hostSetTimeout(() => {
    throw error;
  }, 0);
}

function terminateNodeEvalWithoutDrain(
  state: KeepaliveState,
  record: NodeEvalLifecycleRecord,
  reason: unknown,
  origin: NodeEvalTerminationOrigin,
): void {
  let projected: unknown;
  try {
    projected =
      origin === 'lifecycle-failure' ? reason : record.lifecycle.projectUnhandled(reason, origin);
  } catch (error) {
    terminateNodeEvalWithoutDrain(state, record, error, 'lifecycle-failure');
    return;
  }
  try {
    const terminal = record.lifecycle.terminateUnhandled(projected, origin);
    if (!isRiftyProcessExit(terminal)) {
      throw new Error('node eval lifecycle terminator did not terminate the process');
    }
    state.rejection = { reason: terminal, origin: 'explicit-exit' };
  } catch (error) {
    if (origin !== 'lifecycle-failure') {
      terminateNodeEvalWithoutDrain(state, record, error, 'lifecycle-failure');
      return;
    }
    throwOutsideLifecycle(error);
  }
}

/** Claim the first post-evaluation error/rejection and flush before it terminates. */
export function beginNodeEvalUnhandled(reason: unknown, origin: NodeEvalUnhandledOrigin): boolean {
  if (isRiftyProcessExit(reason)) return false;
  const state = keepaliveState();
  const record = state.nodeEvalLifecycle;
  if (record === null) return false;
  if (record.terminalClaimed) return true;
  record.terminalClaimed = true;
  const pending = { kind: 'unhandled', reason, origin } satisfies NodeEvalPendingTerminal;
  record.pendingTerminal = pending;
  state.rejection = { reason, origin };
  if (state.nodeEvalDrainOwner !== null) return true;
  completeNodeEvalTerminalWithoutDrain(state, record, pending);
  return true;
}

/** Test-only: reset module state between cases. */
export function resetKeepalive(): void {
  const state = keepaliveState();
  state.refCount = 0;
  state.rejection = null;
  state.nodeEvalLifecycle = null;
  state.nodeEvalDrainOwner = null;
  state.nodeEvalDirectTerminalPending = false;
}

/**
 * Release a pending eval drain after a listened port wins the run-vs-serve
 * decision. The drain's identity check makes its later queued tick inert; the
 * live lifecycle remains registered for a served terminal to flush exactly once.
 */
export function releaseNodeEvalDrainOwnership(): void {
  const state = keepaliveState();
  if (state.nodeEvalDrainOwner === null) return;
  state.nodeEvalDrainOwner = null;
  const record = state.nodeEvalLifecycle;
  if (record?.pendingTerminal !== null && record?.pendingTerminal !== undefined) {
    completeNodeEvalTerminalWithoutDrain(state, record, record.pendingTerminal);
  }
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
  const initialState = keepaliveState();
  if (initialState.nodeEvalDirectTerminalPending) {
    // A direct terminal already owns print + diagnostic/control. Resolving or
    // rejecting here would let a later run-vs-serve drain terminate it twice.
    return new PromiseConstructorPrimordial<void>(() => {});
  }
  const nodeEvalDrainLease = initialState.nodeEvalLifecycle === null ? null : {};
  if (nodeEvalDrainLease !== null) initialState.nodeEvalDrainOwner = nodeEvalDrainLease;
  const capMs = opts.capMs ?? DEFAULT_DRAIN_CAP_MS;
  const schedule =
    opts.scheduleMacrotask ??
    ((cb: () => void) => {
      keepaliveState().hostSetTimeout(cb, 0);
    });
  const now = opts.now ?? (() => performance.now());
  const start = now();
  return new PromiseConstructorPrimordial<void>((resolve, reject) => {
    let terminal = false;
    const finish = (
      outcome:
        | { readonly kind: 'resolved' }
        | {
            readonly kind: 'rejected';
            readonly reason: unknown;
            readonly origin: NodeEvalTerminalOrigin;
          },
    ): void => {
      if (terminal) return;
      terminal = true;
      const state = keepaliveState();
      if (nodeEvalDrainLease !== null && state.nodeEvalDrainOwner !== nodeEvalDrainLease) {
        resolve();
        return;
      }
      if (state.nodeEvalDrainOwner === nodeEvalDrainLease) {
        state.nodeEvalDrainOwner = null;
      }
      const record = state.nodeEvalLifecycle;
      if (record !== null) record.terminalClaimed = true;
      const lifecycle = record?.lifecycle;
      const beforeExit = record === null ? undefined : flushNodeEvalDrainLifecycle(record);
      const settled = reflectApplyPrimordial(
        promiseResolvePrimordial,
        PromiseConstructorPrimordial,
        [beforeExit],
      ) as Promise<void>;
      void reflectApplyPrimordial(promiseThenPrimordial, settled, [
        () => {
          try {
            if (outcome.kind === 'resolved') resolve();
            else {
              const projected =
                outcome.origin === 'explicit-exit'
                  ? outcome.reason
                  : (lifecycle?.projectUnhandled(outcome.reason, outcome.origin) ?? outcome.reason);
              reject(projected instanceof Error ? projected : new Error(String(projected)));
            }
          } catch (error) {
            reject(error);
          }
        },
        reject,
      ]);
    };
    const tick = (): void => {
      const state = keepaliveState();
      if (nodeEvalDrainLease !== null && state.nodeEvalDrainOwner !== nodeEvalDrainLease) {
        terminal = true;
        resolve();
        return;
      }
      if (state.rejection !== null) {
        finish({
          kind: 'rejected',
          reason: state.rejection.reason,
          origin: state.rejection.origin,
        });
        return;
      }
      if (state.refCount <= 0) {
        // TODO(backlog: runtime-js/late-unhandled-rejection-drain): cover a late
        // browser unhandledrejection task without a second drain owner.
        finish({ kind: 'resolved' });
        return;
      }
      if (now() - start > capMs) {
        if (state.nodeEvalDrainOwner === nodeEvalDrainLease) {
          state.nodeEvalDrainOwner = null;
        }
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
  preventDefault?(): void;
}
interface RejectionTarget {
  addEventListener(type: 'unhandledrejection', cb: (ev: RejectionEventLike) => void): void;
}

interface ErrorEventLike {
  readonly error?: unknown;
  readonly message?: unknown;
  preventDefault?(): void;
}
interface ErrorTarget {
  addEventListener(type: 'error', cb: (ev: ErrorEventLike) => void): void;
}

interface RiftyProcessExit {
  readonly code: 'RIFTY_PROCESS_EXIT';
  readonly exitCode: number;
}

function isRiftyProcessExit(reason: unknown): reason is RiftyProcessExit {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as { readonly code?: unknown }).code === 'RIFTY_PROCESS_EXIT' &&
    typeof (reason as { readonly exitCode?: unknown }).exitCode === 'number'
  );
}

export function installUnhandledErrorTrap(
  target: ErrorTarget = self as unknown as ErrorTarget,
): void {
  target.addEventListener('error', (event) => {
    const reason =
      'error' in event
        ? event.error
        : typeof event.message === 'string'
          ? new Error(event.message)
          : new Error('Worker terminated by an uncaught error');
    if (!beginNodeEvalUnhandled(reason, 'uncaught-error')) return;
    event.preventDefault?.();
  });
}

/**
 * Trap async unhandled rejections in the worker realm. A try/catch around the
 * entry CANNOT see an async rejection (it's not thrown synchronously); this
 * listener is the only way to make a detached `promise.then` that rejects fail
 * LOUDLY.
 *
 * Eval claims are controlled terminal paths: print flushes before the drain or
 * served-worker fallback emits the diagnostic and exit. Other realms retain
 * default reporting while their run-to-completion drain records the reason.
 */
export function installUnhandledRejectionTrap(
  target: RejectionTarget = self as unknown as RejectionTarget,
): void {
  target.addEventListener('unhandledrejection', (ev: RejectionEventLike) => {
    if (beginNodeEvalUnhandled(ev.reason, 'rejection')) {
      ev.preventDefault?.();
      return;
    }
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
  installUnhandledErrorTrap();
  setKernelDrainHook(() => awaitDrain());
}
