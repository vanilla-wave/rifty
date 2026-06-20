/**
 * Node-compatible timers. We rely on the host's `setTimeout`/`clearTimeout`/
 * `setInterval`/`clearInterval` and polyfill `setImmediate`/`clearImmediate`
 * via `MessageChannel` (post-task scheduling on browsers; jsdom-like envs in
 * Node tests use a `setTimeout(fn, 0)` fallback).
 */

import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';

type ImmediateHandle = { readonly id: number };
type HostTimeout = ReturnType<typeof globalThis.setTimeout>;
type HostInterval = ReturnType<typeof globalThis.setInterval>;
type HostTimer = HostTimeout | HostInterval;
type HostTimerClear = (handle: HostTimer) => void;
interface HostTimerRefHooks {
  ref?: () => unknown;
  unref?: () => unknown;
}

// Capture host timers BEFORE installTimerGlobals can overwrite globals.
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
const hostSetInterval = globalThis.setInterval.bind(globalThis);
const hostClearInterval = globalThis.clearInterval.bind(globalThis);

let nextTimerId = 1;

// primitiveId -> handle, so `clearTimeout(Number(handle))` resolves the live
// handle the way Node does (its Timeout exposes a [Symbol.toPrimitive] id that
// clear* honors). Without this, a coerced numeric id would miss the `instanceof`
// branch and be forwarded to the host clear as an unrelated integer — a no-op
// clear + a leaked keepalive ref (and a possible cross-clear of a host timer
// whose id collides). One-shot timeouts deregister on fire; intervals on clear.
const handlesById = new Map<number, KeepaliveTimerHandle>();

class KeepaliveTimerHandle {
  private active = true;
  private refed = true;
  private readonly primitiveId = nextTimerId++;

  constructor(
    private readonly raw: HostTimer,
    private readonly clearRaw: HostTimerClear,
  ) {
    keepaliveRef();
    handlesById.set(this.primitiveId, this);
  }

  fireTimeout(): boolean {
    if (!this.active) return false;
    this.active = false;
    handlesById.delete(this.primitiveId);
    if (this.refed) keepaliveUnref();
    return true;
  }

  shouldRunInterval(): boolean {
    return this.active;
  }

  clear(): void {
    if (this.active) {
      this.active = false;
      if (this.refed) keepaliveUnref();
    }
    handlesById.delete(this.primitiveId);
    this.clearRaw(this.raw);
  }

  ref(): this {
    if (!this.refed) {
      this.refed = true;
      if (this.active) keepaliveRef();
    }
    const hostRef = (this.raw as HostTimerRefHooks).ref;
    if (typeof hostRef === 'function') hostRef.call(this.raw);
    return this;
  }

  unref(): this {
    if (this.refed) {
      this.refed = false;
      if (this.active) keepaliveUnref();
    }
    const hostUnref = (this.raw as HostTimerRefHooks).unref;
    if (typeof hostUnref === 'function') hostUnref.call(this.raw);
    return this;
  }

  hasRef(): boolean {
    return this.refed;
  }

  [Symbol.toPrimitive](): number {
    return this.primitiveId;
  }
}

export function setTimeout(
  fn: (...a: unknown[]) => void,
  ms?: number,
  ...args: unknown[]
): KeepaliveTimerHandle {
  // Use a box so the inner callback can reference the handle (self-ref timeout pattern).
  const box: { handle: KeepaliveTimerHandle | null } = { handle: null };
  const raw = hostSetTimeout(
    (...a: unknown[]) => {
      if (!box.handle?.fireTimeout()) return;
      fn(...a);
    },
    ms,
    ...args,
  );
  const handle = new KeepaliveTimerHandle(raw, hostClearTimeout as HostTimerClear);
  box.handle = handle;
  return handle;
}

/** Resolve a clear* argument (handle object OR coerced numeric id) to its handle. */
function resolveHandle(handle: unknown): KeepaliveTimerHandle | undefined {
  if (handle instanceof KeepaliveTimerHandle) return handle;
  if (typeof handle === 'number') return handlesById.get(handle);
  return undefined;
}

export function clearTimeout(handle: unknown): void {
  const tracked = resolveHandle(handle);
  if (tracked) {
    tracked.clear();
    return;
  }
  hostClearTimeout(handle as HostTimeout);
}

export function setInterval(
  fn: (...a: unknown[]) => void,
  ms?: number,
  ...args: unknown[]
): KeepaliveTimerHandle {
  const box: { handle: KeepaliveTimerHandle | null } = { handle: null };
  const raw = hostSetInterval(
    (...a: unknown[]) => {
      if (!box.handle?.shouldRunInterval()) return;
      fn(...a);
    },
    ms,
    ...args,
  );
  const handle = new KeepaliveTimerHandle(raw, hostClearInterval as HostTimerClear);
  box.handle = handle;
  return handle;
}

export function clearInterval(handle: unknown): void {
  const tracked = resolveHandle(handle);
  if (tracked) {
    tracked.clear();
    return;
  }
  hostClearInterval(handle as HostInterval);
}

// ADR-0085: setImmediate queue rep + check-phase drain-order contract.
// `./builtins/timers` is a PUBLIC cross-package subpath export (ADR-0018), so
// the drain order is a contract, not an internal detail.
//
// Rep: a Map<id, item> keyed by the monotonic id. ids are positive integers, so
// a Map iterates them in numeric-ascending = insertion order → FIFO drain for
// free. clearImmediate is O(1) (`delete`), replacing the old O(n) findIndex+splice.
//
// Drain: EXACTLY ONE immediate per MessageChannel message. One message per
// setImmediate call ⇒ one immediate per macrotask ⇒ the microtask queue drains
// BETWEEN consecutive immediates — Node check-phase parity. A nested setImmediate
// posts its own (higher-id) message serviced in a LATER check phase (no snapshot
// needed). MessageChannel (not setTimeout(0)) keeps setImmediate ahead of a
// setTimeout(0) task; the no-MessageChannel fallback uses setTimeout(0) and is
// realm-specific (jsdom/node test envs without a check phase).
const immediates = new Map<number, { fn: (...args: unknown[]) => void; args: unknown[] }>();
let nextImmediateId = 1;

const channel: MessageChannel | null =
  typeof MessageChannel === 'function' ? new MessageChannel() : null;

if (channel) {
  channel.port1.onmessage = () => {
    // Drain EXACTLY ONE (lowest id; Map iterates ascending = FIFO). One message
    // per setImmediate call, so consecutive immediates run in SEPARATE macrotasks
    // and the microtask queue drains BETWEEN them — Node check-phase parity. A
    // nested immediate posts its own (higher-id) message → next check phase.
    const first = immediates.keys().next();
    if (first.done) return;
    const id = first.value;
    const item = immediates.get(id);
    if (item === undefined) return; // cleared between message post and dispatch
    immediates.delete(id);
    keepaliveUnref();
    try {
      item.fn(...item.args);
    } catch (err) {
      console.error(err);
    }
  };
}

export function setImmediate(
  fn: (...args: unknown[]) => void,
  ...args: unknown[]
): ImmediateHandle {
  const id = nextImmediateId++;
  immediates.set(id, { fn, args });
  keepaliveRef();
  if (channel) channel.port2.postMessage(null);
  else
    hostSetTimeout(() => {
      const item = immediates.get(id);
      if (!item) return; // cleared before its timer fired
      immediates.delete(id);
      keepaliveUnref();
      item.fn(...item.args);
    }, 0);
  return { id };
}

export function clearImmediate(handle: ImmediateHandle | undefined): void {
  if (!handle) return;
  if (immediates.delete(handle.id)) keepaliveUnref();
}

export const timers = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
  queueMicrotask: globalThis.queueMicrotask,
};

// ───────────────────────────── timers/promises ─────────────────────────────
// Node's `node:timers/promises`: promise-returning timers. opencode imports
// `setTimeout as sleep` (`shell/shell.ts`, several plugins/commands); pino/avvio
// reach it transitively. AbortSignal cancellation is honoured.

interface TimerPromiseOptions {
  readonly signal?: AbortSignal;
  readonly ref?: boolean;
}

/** Node rejects an aborted timer with the signal's `reason`, else an AbortError. */
function abortError(signal: AbortSignal): unknown {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason !== undefined) return reason;
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

function setTimeoutPromise<T = void>(
  delay = 1,
  value?: T,
  options: TimerPromiseOptions = {},
): Promise<T> {
  const { signal, ref = true } = options;
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    let onAbort: (() => void) | undefined;
    const handle = setTimeout(() => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort);
      resolve(value as T);
    }, delay);
    if (ref === false) (handle as unknown as { unref?: () => void }).unref?.();
    if (signal) {
      onAbort = () => {
        clearTimeout(handle);
        reject(abortError(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function setImmediatePromise<T = void>(value?: T, options: TimerPromiseOptions = {}): Promise<T> {
  const { signal } = options;
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    let onAbort: (() => void) | undefined;
    const handle = setImmediate(() => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort);
      resolve(value as T);
    });
    if (signal) {
      onAbort = () => {
        clearImmediate(handle);
        reject(abortError(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function* setIntervalPromise<T = void>(
  delay = 1,
  value?: T,
  options: TimerPromiseOptions = {},
): AsyncGenerator<T> {
  // Forward `ref` so `{ref:false}` opts the between-iterations timer out of
  // keepalive (Node parity); `signal` aborts the iterator.
  const { signal, ref } = options;
  while (true) {
    if (signal?.aborted) throw abortError(signal);
    await setTimeoutPromise(delay, undefined, { signal, ref });
    yield value as T;
  }
}

export const timersPromises = {
  setTimeout: setTimeoutPromise,
  setImmediate: setImmediatePromise,
  setInterval: setIntervalPromise,
  scheduler: {
    wait(delay?: number, options: TimerPromiseOptions = {}): Promise<void> {
      return setTimeoutPromise(delay, undefined, options);
    },
    yield(): Promise<void> {
      return setImmediatePromise(undefined);
    },
  },
};

/** Install setImmediate / clearImmediate + keepalive-wrapped setTimeout/setInterval on globalThis. */
export function installTimerGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.setImmediate = setImmediate;
  g.clearImmediate = clearImmediate;
  g.setTimeout = setTimeout;
  g.clearTimeout = clearTimeout;
  g.setInterval = setInterval;
  g.clearInterval = clearInterval;
}

export default timers;
