/**
 * Re-export shim — the EventEmitter implementation lives in `@riftydev/io`
 * per ADR-0012. Consumers that import this path (relative `./events.ts` or
 * `@riftydev/runtime-js/builtins`) continue to work bit-identically.
 */

import { EventEmitter } from '@riftydev/io';
import { invalidArgType } from '../internal/node-received.ts';

export { EventEmitter, once } from '@riftydev/io';
export default EventEmitter;

/**
 * Node v24.16.0 `lib/internal/events/abort_listener.js` over the realm's `AbortSignal`. Node also
 * passes `kResistStopPropagation`, which only Node's `EventTarget` reads: on a browser host's an
 * earlier listener's `stopImmediatePropagation()` hides the abort
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
    queueMicrotask(() => listener());
  } else {
    signal.addEventListener('abort', listener, {
      __proto__: null,
      once: true,
    } as AddEventListenerOptions);
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
