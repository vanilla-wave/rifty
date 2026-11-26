/**
 * Re-export shim — the EventEmitter implementation lives in `@riftydev/io`
 * per ADR-0012. Consumers that import this path (relative `./events.ts` or
 * `@riftydev/runtime-js/builtins`) continue to work bit-identically.
 */

import { EventEmitter } from '@riftydev/io';
import { AbortError } from '../internal/abort-error.ts';
import { resistingOnceOptions } from '../internal/node-event-target-symbols.ts';
import { invalidArgType } from '../internal/node-received.ts';

export { EventEmitter } from '@riftydev/io';
export default EventEmitter;

// Node queues through its internal `queueMicrotask`: a guest replacing the global changes nothing.
const enqueueMicrotask = queueMicrotask;

/**
 * Node v24.16.0 `lib/internal/events/abort_listener.js` over the realm's `AbortSignal`, with Node's
 * `kResistStopPropagation` where the realm's `EventTarget` is Node's (the isolate guest); on browser
 * hosts an earlier listener's `stopImmediatePropagation()` hides the abort
 * (backlog runtime-js/stream-core-abort-listeners-host-event-target).
 */
export function addAbortListener(signal: AbortSignal, listener: () => void): Disposable {
  if (signal == null || typeof signal !== 'object' || !('aborted' in signal)) {
    throw invalidArgType('"signal" argument', 'an instance of AbortSignal', signal);
  }
  if (typeof listener !== 'function') {
    throw invalidArgType('"listener" argument', 'of type function', listener);
  }
  let removeEventListener: (() => void) | undefined;
  if (signal.aborted) {
    enqueueMicrotask(() => listener());
  } else {
    signal.addEventListener('abort', listener, resistingOnceOptions());
    removeEventListener = () => {
      signal.removeEventListener('abort', listener);
    };
  }
  return {
    __proto__: null,
    [Symbol.dispose]() {
      removeEventListener?.();
    },
  } as Disposable;
}

type Listener = (...args: unknown[]) => void;
const kEmptyObject = Object.freeze({ __proto__: null }) as { signal?: AbortSignal };
interface Agnostic {
  on?: unknown;
  once?: (name: unknown, listener: Listener) => unknown;
  removeListener?: (name: unknown, listener: Listener) => unknown;
  addEventListener?: (name: unknown, listener: Listener, flags?: unknown) => unknown;
  removeEventListener?: (name: unknown, listener: Listener, flags?: unknown) => unknown;
}
function agnosticRemove(emitter: Agnostic, name: unknown, listener: Listener, flags?: unknown) {
  if (typeof emitter.removeListener === 'function') emitter.removeListener(name, listener);
  else if (typeof emitter.removeEventListener === 'function')
    emitter.removeEventListener(name, listener, flags);
  else throw invalidArgType('"emitter" argument', 'an instance of EventEmitter', emitter);
}
function agnosticAdd(emitter: Agnostic, name: unknown, listener: Listener, flags: { once?: boolean }) {
  if (typeof emitter.on === 'function') {
    const ee = emitter as Required<Pick<Agnostic, 'once'>> & { on: Listener };
    if (flags?.once) ee.once(name, listener);
    else ee.on(name, listener);
  } else if (typeof emitter.addEventListener === 'function') {
    emitter.addEventListener(name, listener, flags);
  } else throw invalidArgType('"emitter" argument', 'an instance of EventEmitter', emitter);
}

/** Node v24.16.0 `lib/events.js` `once`: an EventEmitter or an EventTarget; `options.signal` aborts. */
export async function once(
  emitter: unknown,
  name: unknown,
  options: { signal?: AbortSignal } = kEmptyObject,
): Promise<unknown[]> {
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw invalidArgType('"options" argument', 'of type object', options);
  const { signal } = options;
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== 'object' || !('aborted' in signal))
  )
    throw invalidArgType('"options.signal" property', 'an instance of AbortSignal', signal);
  if (signal?.aborted) throw new AbortError(undefined, { cause: signal.reason });
  const target = emitter as Agnostic;
  return new Promise((resolve, reject) => {
    const errorListener = (err: unknown): void => {
      (target as Required<Pick<Agnostic, 'removeListener'>>).removeListener(name, resolver);
      if (signal != null) agnosticRemove(signal as unknown as Agnostic, 'abort', abortListener);
      reject(err);
    };
    const resolver = (...args: unknown[]): void => {
      if (typeof target.removeListener === 'function') target.removeListener('error', errorListener);
      if (signal != null) agnosticRemove(signal as unknown as Agnostic, 'abort', abortListener);
      resolve(args);
    };
    agnosticAdd(target, name, resolver, resistingOnceOptions());
    // EventTarget has no `error` semantics: only an EventEmitter's `error` rejects.
    if (name !== 'error' && typeof target.once === 'function') target.once('error', errorListener);
    function abortListener(): void {
      agnosticRemove(target, name, resolver);
      agnosticRemove(target, 'error', errorListener);
      reject(new AbortError(undefined, { cause: signal?.reason }));
    }
    if (signal != null)
      agnosticAdd(signal as unknown as Agnostic, 'abort', abortListener, resistingOnceOptions());
  });
}
