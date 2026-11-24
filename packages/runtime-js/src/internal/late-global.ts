const reflectConstructPrimordial = Reflect.construct;
const reflectApplyPrimordial = Reflect.apply;

/**
 * A web global constructor the runtime captures at load. Present at load (browser hosts): the
 * capture itself, so a guest replacing the global later changes nothing. Absent at load (a host
 * that installs it after, the isolate guest's ceiling): a forwarder of that name to the global at
 * use time — the host's own named gap there, never `undefined`. `instanceof` checks against the
 * current global.
 */
export function loadedGlobal<T extends abstract new (...args: never[]) => unknown>(
  name: 'URL' | 'URLSearchParams',
): T {
  const realm = globalThis as unknown as Record<string, T | undefined>;
  const loaded = realm[name];
  if (loaded !== undefined) return loaded;
  const current = (): T => realm[name] as T;
  function forward(this: unknown, ...args: unknown[]): unknown {
    return new.target === undefined
      ? reflectApplyPrimordial(current() as unknown as (...a: unknown[]) => unknown, this, args)
      : reflectConstructPrimordial(
          current() as unknown as new (
            ...a: unknown[]
          ) => unknown,
          args,
          new.target,
        );
  }
  Object.defineProperty(forward, 'name', { value: name });
  Object.defineProperty(forward, Symbol.hasInstance, {
    value: (value: unknown): boolean => {
      const ctor = current();
      return typeof ctor === 'function' && value instanceof ctor;
    },
  });
  return forward as unknown as T;
}
