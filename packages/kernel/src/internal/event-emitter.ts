/**
 * Minimal EventEmitter used by the kernel internally. Intentionally a subset
 * of Node's `events.EventEmitter` — the runtime-js builtin in
 * `runtime-js/src/builtins/events.ts` is the Node-compatible full version
 * exposed to user code. Keeping a private copy here avoids a reverse
 * dependency on `runtime-js` from this lower layer.
 */
type Listener = (...args: unknown[]) => void;

export class EventEmitter {
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    const arr = this.listeners.get(event) ?? [];
    arr.push(listener);
    this.listeners.set(event, arr);
    return this;
  }

  off(event: string, listener: Listener): this {
    const arr = this.listeners.get(event);
    if (!arr) return this;
    const idx = arr.indexOf(listener);
    if (idx !== -1) arr.splice(idx, 1);
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapped: Listener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  emit(event: string, ...args: unknown[]): boolean {
    const arr = this.listeners.get(event);
    if (!arr || arr.length === 0) return false;
    for (const listener of arr.slice()) listener(...args);
    return true;
  }
}
