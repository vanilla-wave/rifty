const key = Symbol.for('rifty.io.buffer-clone-refs.v1');
const NativeWeakRef = WeakRef;
const NativeFinalizationRegistry = FinalizationRegistry;
const values = Uint8Array.prototype.values;
const apply = Reflect.apply;
const isView = ArrayBuffer.isView;

interface BufferRefs {
  remember(value: object): void;
  list(isBuffer: (value: unknown) => boolean): object[];
}

function refs(): BufferRefs {
  const existing = Reflect.get(globalThis, key) as BufferRefs | undefined;
  if (existing) return existing;
  const live = new Set<WeakRef<object>>();
  const seen = new WeakSet<object>();
  const cleanup = new NativeFinalizationRegistry<WeakRef<object>>((ref) => live.delete(ref));
  const state: BufferRefs = Object.freeze({
    remember(value: object) {
      if (seen.has(value)) return;
      seen.add(value);
      const ref = new NativeWeakRef(value);
      live.add(ref);
      cleanup.register(value, ref);
    },
    list(isBuffer: (value: unknown) => boolean) {
      const result: object[] = [];
      for (const ref of live) {
        const value = ref.deref();
        if (!value) {
          live.delete(ref);
          continue;
        }
        if (!isBuffer(value)) continue;
        try {
          apply(values, value, []);
        } catch {
          continue;
        }
        result.push(value);
      }
      return result;
    },
  });
  Object.defineProperty(globalThis, key, { value: state });
  return state;
}

export function rememberBuffer(value: object): void {
  refs().remember(value);
}
export function liveBufferCloneRefs(isBuffer: (value: unknown) => boolean): object[] {
  return refs().list(isBuffer);
}

/** Keep native constructor/prototype admission; record adopted byte views as well. */
export function installBufferCloneAdmission(): void {
  const installed = Symbol.for('rifty.io.buffer-clone-admission.v1');
  if (Reflect.get(globalThis, installed)) return;
  const NativeProxy = Proxy;
  const construct = Reflect.construct;
  const remember = (value: unknown): void => {
    if (typeof value === 'object' && value !== null && isView(value)) rememberBuffer(value);
  };
  const NativeBytes = Uint8Array;
  const Bytes = new NativeProxy(NativeBytes, {
    construct(target, args, newTarget) {
      const result = construct(target, args, newTarget) as Uint8Array;
      rememberBuffer(result);
      return result;
    },
  });
  globalThis.Uint8Array = Bytes;
  Object.defineProperty(NativeBytes.prototype, 'constructor', {
    ...Object.getOwnPropertyDescriptor(NativeBytes.prototype, 'constructor'),
    value: Bytes,
  });
  Object.setPrototypeOf = new NativeProxy(Object.setPrototypeOf, {
    apply(target, receiver, args) {
      const result = apply(target, receiver, args);
      remember(args[0]);
      return result;
    },
  });
  Reflect.setPrototypeOf = new NativeProxy(Reflect.setPrototypeOf, {
    apply(target, receiver, args) {
      const result = apply(target, receiver, args);
      if (result) remember(args[0]);
      return result;
    },
  });
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__')!;
  Object.defineProperty(Object.prototype, '__proto__', {
    ...descriptor,
    set: new NativeProxy(descriptor.set!, {
      apply(target, receiver, args) {
        const result = apply(target, receiver, args);
        remember(receiver);
        return result;
      },
    }),
  });
  Reflect.construct = new NativeProxy(construct, {
    apply(target, receiver, args) {
      const result = apply(target, receiver, args);
      remember(result);
      return result;
    },
  });
  Object.defineProperty(globalThis, installed, { value: true });
}
