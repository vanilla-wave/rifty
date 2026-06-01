/**
 * Node-compatible timers. We rely on the host's `setTimeout`/`clearTimeout`/
 * `setInterval`/`clearInterval` and polyfill `setImmediate`/`clearImmediate`
 * via `MessageChannel` (post-task scheduling on browsers; jsdom-like envs in
 * Node tests use a `setTimeout(fn, 0)` fallback).
 */

type ImmediateHandle = { readonly id: number };

const immediateQueue: Array<{ id: number; fn: (...args: unknown[]) => void; args: unknown[] }> = [];
let nextImmediateId = 1;

const channel: MessageChannel | null =
  typeof MessageChannel === 'function' ? new MessageChannel() : null;

if (channel) {
  channel.port1.onmessage = () => {
    const item = immediateQueue.shift();
    if (item) {
      try {
        item.fn(...item.args);
      } catch (err) {
        console.error(err);
      }
    }
  };
}

export function setImmediate(
  fn: (...args: unknown[]) => void,
  ...args: unknown[]
): ImmediateHandle {
  const id = nextImmediateId++;
  immediateQueue.push({ id, fn, args });
  if (channel) channel.port2.postMessage(null);
  else
    setTimeout(() => {
      const idx = immediateQueue.findIndex((q) => q.id === id);
      if (idx === -1) return;
      const [item] = immediateQueue.splice(idx, 1);
      item?.fn(...item.args);
    }, 0);
  return { id };
}

export function clearImmediate(handle: ImmediateHandle | undefined): void {
  if (!handle) return;
  const idx = immediateQueue.findIndex((q) => q.id === handle.id);
  if (idx !== -1) immediateQueue.splice(idx, 1);
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
  const { signal } = options;
  while (true) {
    if (signal?.aborted) throw abortError(signal);
    await setTimeoutPromise(delay, undefined, { signal });
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

/** Install setImmediate / clearImmediate on globalThis (Node-style). */
export function installTimerGlobals(): void {
  (globalThis as unknown as { setImmediate: typeof setImmediate }).setImmediate = setImmediate;
  (globalThis as unknown as { clearImmediate: typeof clearImmediate }).clearImmediate =
    clearImmediate;
}

export default timers;
