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

  private listenersMap: Map<string | symbol, Listener[]> = new Map();
  private maxListeners: number = DEFAULT_MAX_LISTENERS;

  on(event: string | symbol, listener: Listener): this {
    return this.addListener(event, listener);
  }

  addListener(event: string | symbol, listener: Listener): this {
    // Node emits `newListener` BEFORE the listener is added (so handlers can
    // see the previous count). Don't re-emit for the meta-event itself.
    if (event !== 'newListener') {
      const meta = this.listenersMap.get('newListener');
      if (meta && meta.length > 0) {
        for (const m of meta.slice()) m.call(this, event, listener);
      }
    }
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
    const arr = this.listenersMap.get(event);
    if (arr) {
      arr.unshift(listener);
    } else {
      this.listenersMap.set(event, [listener]);
    }
    return this;
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
    for (let i = arr.length - 1; i >= 0; i--) {
      const entry = arr[i];
      if (entry === listener || (entry as { listener?: Listener }).listener === listener) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) this.listenersMap.delete(event);
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
    // Snapshot — listeners added during emit don't fire for this event.
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
