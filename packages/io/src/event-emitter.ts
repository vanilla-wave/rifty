/**
 * Node-compatible `node:events` EventEmitter. Per ADR-0012 this primitive lives
 * in `@riftydev/io`, consumed by `@riftydev/runtime-js`, `@riftydev/kernel`, `@riftydev/net`.
 *
 * Node contract replicated:
 *   - `emit('error', ...)` with no listener throws.
 *   - Listeners added during emit don't fire for the in-flight event.
 *   - `once(name, fn)` wraps fn; wrapper removes itself before invoking fn.
 *   - max-listeners cap warns once when exceeded.
 */
type Listener = (...args: unknown[]) => void;

const captureRejectionSymbol = Symbol.for('nodejs.rejection');
const DEFAULT_MAX_LISTENERS = 10;

class EventEmitterPrototype {
  // State is lazily created so methods work when the constructor never ran —
  // e.g. express mixing `EventEmitter.prototype` onto a plain function via
  // `merge-descriptors`, or send's `SendStream` via `EventEmitter.call(this)`
  // through `util.inherits`. Node lazily inits `_events`; eager class fields
  // broke both idioms, lazy getters mirror Node.
  private _listenersMap?: Map<string | symbol, Listener[]>;
  private _maxListeners?: number;
  private _warned?: Set<string | symbol>;

  private get listenersMap(): Map<string | symbol, Listener[]> {
    if (this._listenersMap === undefined) this._listenersMap = new Map();
    return this._listenersMap;
  }

  private get warned(): Set<string | symbol> {
    if (this._warned === undefined) this._warned = new Set();
    return this._warned;
  }

  on(event: string | symbol, listener: Listener): this {
    return this.addListener(event, listener);
  }

  addListener(event: string | symbol, listener: Listener): this {
    this.emitNewListener(event, listener);
    const arr = this.listenersMap.get(event);
    if (arr) {
      arr.push(listener);
    } else {
      this.listenersMap.set(event, [listener]);
    }
    this.emitNew(event, listener);
    return this;
  }

  prependListener(event: string | symbol, listener: Listener): this {
    this.emitNewListener(event, listener);
    const arr = this.listenersMap.get(event);
    if (arr) {
      arr.unshift(listener);
    } else {
      this.listenersMap.set(event, [listener]);
    }
    return this;
  }

  /**
   * Emit `newListener` BEFORE the target is added (so handlers see the previous
   * count); skip for the meta-event itself. Shared by {@link addListener} and
   * {@link prependListener} for identical Node `newListener` semantics.
   */
  private emitNewListener(event: string | symbol, listener: Listener): void {
    if (event === 'newListener') return;
    const meta = this.listenersMap.get('newListener');
    if (!meta || meta.length === 0) return;
    for (const m of meta.slice()) m.call(this, event, listener);
  }

  off(event: string | symbol, listener: Listener): this {
    return this.removeListener(event, listener);
  }

  removeListener(event: string | symbol, listener: Listener): this {
    const arr = this.listenersMap.get(event);
    if (!arr) return this;
    // Match by reference first, then by `.listener` (the original passed to
    // `once`). Node removes the last-added match, scanning from the back.
    let idx = -1;
    let removed: Listener | undefined;
    for (let i = arr.length - 1; i >= 0; i--) {
      const entry = arr[i];
      if (entry === listener || (entry as { listener?: Listener }).listener === listener) {
        idx = i;
        removed = entry;
        break;
      }
    }
    if (idx === -1) return this;
    arr.splice(idx, 1);
    if (arr.length === 0) this.listenersMap.delete(event);
    // Node emits `'removeListener'` AFTER detach (handlers see post-removal
    // count). Suppress when the removed event IS `removeListener` — else
    // `removeListener('removeListener', ...)` recurses infinitely.
    if (event !== 'removeListener' && removed !== undefined) {
      const meta = this.listenersMap.get('removeListener');
      if (meta && meta.length > 0) {
        for (const m of meta.slice()) m.call(this, event, removed);
      }
    }
    return this;
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this.listenersMap.clear();
    else this.listenersMap.delete(event);
    return this;
  }

  once(event: string | symbol, listener: Listener): this {
    const wrapper: Listener = (...args) => {
      this.removeListener(event, wrapper);
      listener.apply(this, args);
    };
    // Preserve `listener` reference for `removeListener(event, listener)`
    // compatibility with how Node lets you remove by-original-fn.
    (wrapper as { listener?: Listener }).listener = listener;
    return this.on(event, wrapper);
  }

  prependOnceListener(event: string | symbol, listener: Listener): this {
    const wrapper: Listener = (...args) => {
      this.removeListener(event, wrapper);
      listener.apply(this, args);
    };
    (wrapper as { listener?: Listener }).listener = listener;
    return this.prependListener(event, wrapper);
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const arr = this.listenersMap.get(event);
    if (!arr || arr.length === 0) {
      if (event === 'error') {
        const err = args[0];
        if (err instanceof Error) throw err;
        throw new Error(`Unhandled 'error' event: ${String(err)}`);
      }
      return false;
    }
    if (arr.length === 1) {
      // Single listener: read into a local BEFORE invoking, so a once-wrapper /
      // removeListener that mutates `arr` during its own call can't perturb the
      // (already-captured) entry — equivalent to a 1-element slice, no alloc.
      const only = arr[0];
      if (only) only.apply(this, args);
      return true;
    }
    // len>1: KEEP the slice() snapshot so listeners added/removed during emit
    // don't perturb the in-flight iteration (Node semantics).
    const snapshot = arr.slice();
    for (const l of snapshot) l.apply(this, args);
    return true;
  }

  listenerCount(event: string | symbol): number {
    return this.listenersMap.get(event)?.length ?? 0;
  }

  /**
   * Node's `listeners(name)`: returns the unwrapped listeners — i.e. for a
   * `once(name, fn)` registration, returns `fn`, not the internal wrapper.
   */
  listeners(event: string | symbol): Listener[] {
    const arr = this.listenersMap.get(event);
    if (!arr) return [];
    return arr.map((l) => (l as { listener?: Listener }).listener ?? l);
  }

  /**
   * Node's `rawListeners(name)`: returns the stored entries verbatim. For
   * a `once()` registration, that's the wrapper function (which has its
   * `.listener` property set to the original).
   */
  rawListeners(event: string | symbol): Listener[] {
    return this.listenersMap.get(event)?.slice() ?? [];
  }

  eventNames(): (string | symbol)[] {
    return [...this.listenersMap.keys()];
  }

  setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this._maxListeners ?? EventEmitter.defaultMaxListeners;
  }

  private emitNew(event: string | symbol, _listener: Listener): void {
    const max = this.getMaxListeners();
    const count = this.listenerCount(event);
    if (max > 0 && count > max && !this.warned.has(event)) {
      this.warned.add(event);
      console.warn(
        `MaxListenersExceededWarning: ${count} ${String(event)} listeners added. Use setMaxListeners() to increase the limit.`,
      );
    }
  }
}

/**
 * Node exposes EventEmitter as one function that supports BOTH construction
 * (`new EventEmitter()`) and legacy initialisation (`EventEmitter.call(this)`).
 * Keep the listener implementation class-shaped for private state and method
 * typing, but publish its prototype through that single callable boundary.
 */
export type EventEmitter = EventEmitterPrototype;

interface EventEmitterConstructor {
  new (): EventEmitter;
  (this: EventEmitter): void;
  readonly prototype: EventEmitter;
  defaultMaxListeners: number;
  captureRejectionSymbol: symbol;
}

/**
 * Node's `EventEmitter.init` semantics for the callable form: a receiver that
 * only inherits listener state gets a fresh own store, while a receiver that
 * already owns one keeps it (re-initialising would drop live listeners).
 */
function initialiseOwnListenerState(target: EventEmitter): void {
  if (target === null || typeof target !== 'object') return;
  const state = target as unknown as {
    _listenersMap?: Map<string | symbol, Listener[]>;
    _warned?: Set<string | symbol>;
  };
  if (!Object.hasOwn(state, '_listenersMap')) state._listenersMap = new Map();
  if (!Object.hasOwn(state, '_warned')) state._warned = new Set();
}

const CallableEventEmitter = function EventEmitter(this: EventEmitter): void {
  // Listener state stays lazy so this also supports prototype mixins whose
  // constructors never call EventEmitter, matching Node's EventEmitter.init.
  // What init does NOT tolerate is a receiver that merely INHERITS a store:
  // `Foo.prototype = new EventEmitter()` would otherwise share one listener
  // map across every instance. Claim an own, empty one instead.
  initialiseOwnListenerState(this);
};

CallableEventEmitter.prototype = EventEmitterPrototype.prototype;
Object.defineProperty(CallableEventEmitter.prototype, 'constructor', {
  configurable: true,
  value: CallableEventEmitter,
  writable: true,
});

export const EventEmitter = CallableEventEmitter as EventEmitterConstructor;
EventEmitter.defaultMaxListeners = DEFAULT_MAX_LISTENERS;
EventEmitter.captureRejectionSymbol = captureRejectionSymbol;

export function once(emitter: EventEmitter, event: string | symbol): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    // Remove BOTH listeners on either path. `once` wrappers auto-remove the
    // firing one, but explicit cleanup stays correct if a custom `once` doesn't.
    const cleanup = (): void => {
      emitter.off(event, onEvent);
      if (event !== 'error') emitter.off('error', onError);
    };
    const onEvent = (...args: unknown[]): void => {
      cleanup();
      resolve(args);
    };
    const onError = (err: unknown): void => {
      cleanup();
      reject(err);
    };
    emitter.once(event, onEvent);
    if (event !== 'error') emitter.once('error', onError);
  });
}

export default EventEmitter;
