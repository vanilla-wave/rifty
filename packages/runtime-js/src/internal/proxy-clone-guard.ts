const readerKey = Symbol.for('rifty.runtime-js.proxy-clone-reader.v1');
const apply = Reflect.apply;
const construct = Reflect.construct;

/** Native clone rejects Proxy before inspecting traps; JS cannot recover its brand. */
export function installProxyCloneGuard(): void {
  if (typeof Reflect.get(globalThis, readerKey) === 'function') return;
  const Native = globalThis.Proxy;
  const proxies = new WeakSet<object>();
  const add = WeakSet.prototype.add;
  const has = WeakSet.prototype.has;
  const remember = (value: object): object => {
    apply(add, proxies, [value]);
    return value;
  };
  const revocable = new Native(Native.revocable, {
    apply(target, receiver, args) {
      const result = apply(target, receiver, args) as { proxy: object; revoke: () => void };
      remember(result.proxy);
      return result;
    },
  });
  Object.defineProperty(Native, 'revocable', {
    ...Object.getOwnPropertyDescriptor(Native, 'revocable'),
    value: revocable,
  });
  globalThis.Proxy = new Native(Native, {
    construct(target, args, newTarget) {
      // lib ProxyConstructor omits Function's members; the native target is callable.
      return remember(
        construct(target as unknown as (...args: unknown[]) => object, args, newTarget),
      );
    },
  });
  Object.defineProperty(globalThis, readerKey, {
    value: (value: object): boolean => apply(has, proxies, [value]) as boolean,
    configurable: false,
    writable: false,
    enumerable: false,
  });
}

export function isTrackedProxy(value: object): boolean {
  const reader = Reflect.get(globalThis, readerKey) as ((value: object) => boolean) | undefined;
  return reader?.(value) === true;
}
