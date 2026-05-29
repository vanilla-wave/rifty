/**
 * Importable-but-loud stubs for low-traffic Node builtins. Vite and a couple
 * of its transitive deps reach for these at module load time even though they
 * almost never call into them on the dev path. Every access throws so we
 * notice the day one actually does.
 */
import { NotImplementedError } from '@rifty/io';

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
};
export const inspector = loudProxy('inspector');
export const repl = loudProxy('repl');
export const constants = {} as Record<string, number>;
export const punycode = loudProxy('punycode');
export const sys = loudProxy('sys');
export const cluster = loudProxy('cluster');
