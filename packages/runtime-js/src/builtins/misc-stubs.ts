/**
 * Importable-but-loud stubs for low-traffic Node builtins. Vite and a couple
 * of its transitive deps reach for these at module load time even though they
 * almost never call into them on the dev path. Every access throws so we
 * notice the day one actually does.
 */
import { NotImplementedError } from '@riftydev/io';

function loudProxy(name: string): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === '__esModule') return true;
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'default') return loudProxy(`${name}.default`);
        return () => {
          throw new NotImplementedError(`${name}.${String(prop)}`);
        };
      },
    },
  );
}

export const v8 = {
  getHeapStatistics(): never {
    throw new NotImplementedError('v8.getHeapStatistics');
  },
  serialize(_value: unknown): never {
    throw new NotImplementedError('v8.serialize');
  },
  deserialize(_buf: Uint8Array): never {
    throw new NotImplementedError('v8.deserialize');
  },
};

export const vm = loudProxy('vm');
export const async_hooks = {
  createHook(_handlers: unknown): { enable(): void; disable(): void } {
    return { enable() {}, disable() {} };
  },
  executionAsyncId(): number {
    return 0;
  },
  AsyncResource: class AsyncResource {
    constructor(_type: string) {}
    /**
     * Node's `runInAsyncScope(fn, thisArg, ...args)` invokes `fn` with the
     * given receiver and arguments and returns its result. We don't track async
     * context, but we MUST forward thisArg/args/return — raw-body@2.5.x binds
     * its completion callback this way, and dropping the args silently lost the
     * parsed body (`(err, buf)` → `()`).
     */
    runInAsyncScope<T>(fn: (...args: unknown[]) => T, thisArg?: unknown, ...args: unknown[]): T {
      return fn.apply(thisArg, args);
    }
    emitDestroy(): this {
      return this;
    }
  },
  /**
   * Continuation-local storage with **synchronous-scope fidelity**. `run` /
   * `getStore` / `enterWith` / `exit` / `disable` behave exactly like Node's
   * `AsyncLocalStorage` throughout synchronous execution and the synchronous
   * prefix of an async function (up to its first `await`) — which is what
   * opencode's `LocalContext.{provide,use}` (`util/local-context.ts`) relies on.
   *
   * The store is NOT propagated across async scheduling boundaries (after an
   * `await`/timer/microtask resumes, `getStore()` reflects the store of whatever
   * is currently on the stack, not the one captured at suspension). Faithful
   * cross-`await` propagation requires native async-context tracking
   * (`async_hooks` enter/exit hooks, or the TC39 `AsyncContext` proposal) which
   * the browser/WASI realm does not expose. This is a documented partial
   * fidelity, not a fake stub: synchronous use is byte-for-byte Node-correct.
   */
  AsyncLocalStorage: class AsyncLocalStorage<T> {
    #store: T | undefined = undefined;

    getStore(): T | undefined {
      return this.#store;
    }

    run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
      const previous = this.#store;
      this.#store = store;
      try {
        return callback(...args);
      } finally {
        this.#store = previous;
      }
    }

    exit<R>(callback: (...args: unknown[]) => R, ...args: unknown[]): R {
      const previous = this.#store;
      this.#store = undefined;
      try {
        return callback(...args);
      } finally {
        this.#store = previous;
      }
    }

    enterWith(store: T): void {
      this.#store = store;
    }

    disable(): void {
      this.#store = undefined;
    }
  },
};
export const inspector = loudProxy('inspector');
export const repl = loudProxy('repl');
export const constants = {} as Record<string, number>;
export const punycode = loudProxy('punycode');
export const sys = loudProxy('sys');
export const cluster = loudProxy('cluster');
