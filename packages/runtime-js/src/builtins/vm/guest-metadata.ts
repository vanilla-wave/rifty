import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core';
import type { ContextLifetime } from './context-lifetime.ts';

/** Eager, private guest authority. No guest property is used to identify a value. */
const BOOTSTRAP = `(() => {
  const NativeProxy = Proxy, apply = Reflect.apply, construct = Reflect.construct;
  const get = WeakMap.prototype.get, put = WeakMap.prototype.set;
  const ids = new WeakMap(), proxies = new WeakMap(), originals = new WeakMap();
  const define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
  const isArray = Array.isArray, toString = Function.prototype.toString;
  const mapHas = Map.prototype.has, setHas = Set.prototype.has;
  const mapEach = Map.prototype.forEach, setEach = Set.prototype.forEach;
  let next = 0;
  const read = (map, key) => apply(get, map, [key]);
  const write = (map, key, value) => apply(put, map, [key, value]);
  const facade = (target, traps) => {
    const value = new NativeProxy(target, traps);
    write(originals, value, target);
    return value;
  };
  const proxy = facade(NativeProxy, { construct(target, args, newTarget) {
    const value = construct(target, args, newTarget);
    write(proxies, value, { target: args[0], revoked: false });
    return value;
  }});
  const revocable = facade(NativeProxy.revocable, { apply(target, receiver, args) {
    const result = apply(target, receiver, args);
    const state = { target: args[0], revoked: false };
    write(proxies, result.proxy, state);
    result.revoke = facade(result.revoke, { apply(target, receiver, args) {
      state.revoked = true;
      return apply(target, receiver, args);
    }});
    return result;
  }});
  const source = facade(toString, { apply(target, receiver, args) {
    return apply(target, read(originals, receiver) || receiver, args);
  }});
  define(NativeProxy, 'revocable', { ...descriptor(NativeProxy, 'revocable'), value: revocable });
  define(globalThis, 'Proxy', { ...descriptor(globalThis, 'Proxy'), value: proxy });
  define(Function.prototype, 'toString', { ...descriptor(Function.prototype, 'toString'), value: source });
  const collection = value => {
    try { apply(mapHas, value, [null]); return 'Map'; } catch {}
    try { apply(setHas, value, [null]); return 'Set'; } catch {}
    return '';
  };
  const targetOf = value => {
    let state;
    while ((state = read(proxies, value))) {
      if (state.revoked) return null;
      value = state.target;
    }
    return value;
  };
  return (op, value) => {
    if (op === 'id') {
      let id = read(ids, value);
      if (id === undefined) { id = ++next; write(ids, value, id); }
      return id;
    }
    if (op === 'proxy') return !!read(proxies, value);
    if (op === 'array') {
      const target = targetOf(value);
      return target !== null && isArray(target);
    }
    if (op === 'collection') return collection(value);
    if (op === 'entries') {
      const result = [];
      if (collection(value) === 'Map') apply(mapEach, value, [(v, k) => { result[result.length] = [k, v]; }]);
      else apply(setEach, value, [v => { result[result.length] = v; }]);
      return result;
    }
    throw new TypeError('unknown vm metadata operation');
  };
})()`;

export class GuestMetadata {
  readonly #handle: QuickJSHandle;
  constructor(
    readonly ctx: QuickJSContext,
    lifetime: ContextLifetime,
  ) {
    this.#handle = ctx.unwrapResult(ctx.evalCode(BOOTSTRAP));
    lifetime.trackInfra(this.#handle);
  }
  call(operation: string, value: QuickJSHandle): QuickJSHandle {
    const op = this.ctx.newString(operation);
    try {
      return this.ctx.unwrapResult(
        this.ctx.callFunction(this.#handle, this.ctx.undefined, op, value),
      );
    } finally {
      op.dispose();
    }
  }
  read(operation: string, value: QuickJSHandle): string | number | boolean {
    const result = this.call(operation, value);
    try {
      return this.ctx.dump(result) as string | number | boolean;
    } finally {
      result.dispose();
    }
  }
}
