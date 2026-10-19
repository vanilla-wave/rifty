export interface ProxyIdentity {
  isProxy(value: unknown): boolean;
  record(value: object, isProxy: boolean): void;
  wrap<T extends object>(target: T, handler: ProxyHandler<T>): T;
}

/** Self-contained: the same bootstrap also runs inside a fresh QuickJS realm. */
export function createProxyIdentity(): ProxyIdentity {
  const kinds = new WeakMap<object, boolean>();
  const Original = globalThis.Proxy;
  const record = (value: object, proxy: boolean): void => {
    kinds.set(value, proxy);
  };
  const revocable = new Original(Original.revocable, {
    apply(original, self, args) {
      const pair = Reflect.apply(original, self, args) as { proxy: object; revoke: () => void };
      record(pair.proxy, true);
      return pair;
    },
  });
  Object.defineProperty(Original, 'revocable', {
    ...Object.getOwnPropertyDescriptor(Original, 'revocable'),
    value: revocable,
  });
  globalThis.Proxy = new Original(Original, {
    construct(original, args, newTarget) {
      const proxy = Reflect.construct(original, args, newTarget) as object;
      record(proxy, true);
      return proxy;
    },
  });
  return Object.freeze({
    isProxy(value: unknown): boolean {
      return (
        ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
        kinds.get(value) === true
      );
    },
    record,
    wrap<T extends object>(target: T, handler: ProxyHandler<T>): T {
      return new Original(target, handler);
    },
  });
}

const key = Symbol.for('rifty.proxy-identity');
const NativeProxy = globalThis.Proxy;

/** Infrastructure wrappers represent their target, not a guest-created Proxy. */
export function runtimeProxy<T extends object>(target: T, handler: ProxyHandler<T>): T {
  const identity = (globalThis as unknown as Record<symbol, ProxyIdentity | undefined>)[key];
  return identity === undefined ? new NativeProxy(target, handler) : identity.wrap(target, handler);
}

export function proxyIdentity(): ProxyIdentity {
  const realm = globalThis as unknown as Record<symbol, ProxyIdentity | undefined>;
  const existing = realm[key];
  if (existing !== undefined) return existing;
  const identity = createProxyIdentity();
  Object.defineProperty(globalThis, key, { value: identity });
  return identity;
}
