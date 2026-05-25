/**
 * Node-compatible `node:events` — EventEmitter, owned by `@rifty/io`.
 *
 * Behaviours we replicate (from the Node docs):
 *   - `emit('error', ...)` with no listener throws.
 *   - Listeners can be added during emit; they don't fire for the in-flight event.
 *   - `once(name, fn)` wraps fn; the wrapper removes itself before invoking fn.
 *   - `getMaxListeners` / `setMaxListeners` track a per-emitter cap; if exceeded
 *     we log a warning once (Node prints to stderr).
 *
 * Per ADR-0012, this primitive lives in `@rifty/io` and is consumed by
 * `@rifty/runtime-js`, `@rifty/kernel`, and `@rifty/net`.
 */
type Listener = (...args: unknown[]) => void;

const captureRejectionSymbol = Symbol.for('nodejs.rejection');
const DEFAULT_MAX_LISTENERS = 10;

export class EventEmitter {
  static defaultMaxListeners = DEFAULT_MAX_LISTENERS;
  static captureRejectionSymbol = captureRejectionSymbol;

  private listeners: Map<string | symbol, Listener[]> = new Map();
  private maxListeners: number = DEFAULT_MAX_LISTENERS;

  on(event: string | symbol, listener: Listener): this {
    return this.addListener(event, listener);
  }

  addListener(event: string | symbol, listener: Listener): this {
    // Node emits `newListener` BEFORE the listener is added (so handlers can
    // see the previous count). Don't re-emit for the meta-event itself.
    if (event !== 'newListener') {
      const meta = this.listeners.get('newListener');
      if (meta && meta.length > 0) {
        for (const m of meta.slice()) m.call(this, event, listener);
      }
    }
    const arr = this.listeners.get(event);
    if (arr) {
      arr.push(listener);
    } else {
      this.listeners.set(event, [listener]);
    }
    this.emitNew(event, listener);
    return this;
  }

  prependListener(event: string | symbol, listener: Listener): this {
    const arr = this.listeners.get(event);
    if (arr) {
      arr.unshift(listener);
    } else {
      this.listeners.set(event, [listener]);
    }
    return this;
  }

  off(event: string | symbol, listener: Listener): this {
    return this.removeListener(event, listener);
  }

  removeListener(event: string | symbol, listener: Listener): this {
    const arr = this.listeners.get(event);
    if (!arr) return this;
    const idx = arr.indexOf(listener);
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) this.listeners.delete(event);
    return this;
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
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
    const arr = this.listeners.get(event);
    if (!arr || arr.length === 0) {
      if (event === 'error') {
        const err = args[0];
        if (err instanceof Error) throw err;
        throw new Error(`Unhandled 'error' event: ${String(err)}`);
      }
      return false;
    }
    // Snapshot — listeners added during emit don't fire for this event.
    const snapshot = arr.slice();
    for (const l of snapshot) l.apply(this, args);
    return true;
  }

  listenerCount(event: string | symbol): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  listeners_(event: string | symbol): Listener[] {
    return this.listeners.get(event)?.slice() ?? [];
  }

  // Node's name for the above; renamed because TS clashed.
  rawListeners(event: string | symbol): Listener[] {
    return this.listeners.get(event)?.slice() ?? [];
  }

  eventNames(): (string | symbol)[] {
    return [...this.listeners.keys()];
  }

  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this.maxListeners;
  }

  private warned = new Set<string | symbol>();
  private emitNew(event: string | symbol, _listener: Listener): void {
    const count = this.listenerCount(event);
    if (this.maxListeners > 0 && count > this.maxListeners && !this.warned.has(event)) {
      this.warned.add(event);
      console.warn(
        `MaxListenersExceededWarning: ${count} ${String(event)} listeners added. Use setMaxListeners() to increase the limit.`,
      );
    }
  }
}

// Re-export `listeners` under the Node name. (TS doesn't let us name a method
// `listeners` when there's a field with the same name; expose a static helper.)
EventEmitter.prototype.constructor === EventEmitter;
Object.defineProperty(EventEmitter.prototype, 'listeners', {
  configurable: true,
  writable: true,
  value: function listeners(this: EventEmitter, event: string | symbol) {
    return (this as unknown as { listeners_(e: string | symbol): Listener[] }).listeners_(event);
  },
});

export function once(emitter: EventEmitter, event: string | symbol): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const onEvent = (...args: unknown[]) => {
      emitter.off('error', onError);
      resolve(args);
    };
    const onError = (err: unknown) => {
      emitter.off(event, onEvent);
      reject(err);
    };
    emitter.once(event, onEvent);
    if (event !== 'error') emitter.once('error', onError);
  });
}

export default EventEmitter;
