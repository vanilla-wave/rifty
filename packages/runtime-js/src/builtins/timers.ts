/**
 * Node-compatible timers. We rely on the host's `setTimeout`/`clearTimeout`/
 * `setInterval`/`clearInterval` and polyfill `setImmediate`/`clearImmediate`
 * via `MessageChannel` (post-task scheduling on browsers; jsdom-like envs in
 * Node tests use a `setTimeout(fn, 0)` fallback).
 */

type ImmediateHandle = { readonly id: number };

// ADR-0085: setImmediate queue rep + check-phase drain-order contract.
// `./builtins/timers` is a PUBLIC cross-package subpath export (ADR-0018), so
// the drain order is a contract, not an internal detail.
//
// Rep: a Map<id, item> keyed by the monotonic id. ids are positive integers, so
// a Map iterates them in numeric-ascending = insertion order → FIFO drain for
// free. clearImmediate is O(1) (`delete`), replacing the old O(n) findIndex+splice.
//
// Scheduling is UNCHANGED from the array impl: one MessageChannel message per
// scheduled immediate (NOT setTimeout(0)). That preserves two emergent
// guarantees the array+single-shift impl had for free — and which the batched
// drain would otherwise BREAK:
//   (1) nested setImmediate defers to the NEXT check phase — re-established by
//       the TAIL SNAPSHOT: each drain captures `nextImmediateId` on entry and
//       runs only ids strictly below it; an immediate scheduled DURING the drain
//       gets a higher id and is left for its own (later) message = next phase.
//   (2) setImmediate beats setTimeout(0) — the MessageChannel task dispatches
//       ahead of a setTimeout(0) task; keeping MessageChannel (not setTimeout)
//       preserves it. The no-MessageChannel fallback uses setTimeout(0) for both
//       and is realm-specific (jsdom/node test envs without a check phase).
const immediates = new Map<number, { fn: (...args: unknown[]) => void; args: unknown[] }>();
let nextImmediateId = 1;

const channel: MessageChannel | null =
  typeof MessageChannel === 'function' ? new MessageChannel() : null;

if (channel) {
  channel.port1.onmessage = () => {
    // Tail snapshot: only items queued BEFORE this drain began are eligible. An
    // immediate scheduled by a callback below gets id >= tail and is serviced by
    // its own message (next check phase), never drained in this same phase.
    const tail = nextImmediateId;
    for (const [id, item] of immediates) {
      if (id >= tail) break; // Map iterates ascending — the rest are nested.
      immediates.delete(id);
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
  immediates.set(id, { fn, args });
  if (channel) channel.port2.postMessage(null);
  else
    setTimeout(() => {
      const item = immediates.get(id);
      if (!item) return; // cleared before its timer fired
      immediates.delete(id);
      item.fn(...item.args);
    }, 0);
  return { id };
}

export function clearImmediate(handle: ImmediateHandle | undefined): void {
  if (!handle) return;
  immediates.delete(handle.id);
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
