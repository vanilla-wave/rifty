/**
 * Route B product bindings: what the generated Node stream core (generate.mjs → node-streams.js) reads
 * outside its own modules, from rifty modules and host globals; no Node internals. `primordials` are
 * captured at load (url-legacy precedent). Named gaps throw NotImplementedError or are listed below.
 * Gaps: `internal/event_target` symbols are fresh (a host EventTarget ignores them: abort listeners are
 * strong and stop-propagation-able); `internal/fs/promises.FileHandle` nothing is an instance of (a
 * FileHandle `fd` option is refused as Node refuses a non-number); `stream_wrap`/`uv` handles (StreamBase
 * web adapters, unreachable without a handle) throw.
 */

type Fn = (...args: never[]) => unknown;
type Mod = Record<string, unknown>;
export interface RouteBHost {
  /**
   * A rifty module by id (buffer events string_decoder fs async_hooks util url zlib), read when first needed;
   * `undefined` when this realm has none (io without runtime-js): then `debuglog` is off (no process, no
   * NODE_DEBUG), `AsyncResource` is rifty's pass-through (no async context exists), any other id throws.
   */
  module(id: string): unknown;
  /** The `process` Node's modules see. */
  process: unknown;
  NotImplementedError: new (feature: string, detail?: string) => Error;
}
type CreateNodeStreams = (
  primordials: Mod,
  internalBinding: (id: string) => unknown,
  bind: (id: string) => unknown,
  process: unknown,
) => (id: string) => unknown;

/** Node's `uncurryThis`: `bind.bind(call)`. */
const uncurry = <T extends Fn>(f: T) =>
  Function.prototype.bind.call(Function.prototype.call, f) as (
    self: unknown,
    ...a: unknown[]
  ) => unknown;
const getter = (proto: object, key: PropertyKey) =>
  uncurry(Reflect.getOwnPropertyDescriptor(proto, key)?.get as Fn);

/** The primordials the generated modules destructure (node-streams.js `PRIMORDIALS`), Node's definitions; built on first use (tree-shakable). */
export function makePrimordials(): Mod {
  const { call } = Function.prototype;
  const TypedArray = Reflect.getPrototypeOf(Uint8Array) as { prototype: object };
  const ArrayIteratorPrototypeNext = uncurry(
    (Reflect.getPrototypeOf([][Symbol.iterator]()) as { next: Fn }).next,
  );

  /** Node's `createSafeIterator`. */
  function createSafeIterator(factory: (x: unknown) => unknown, next: (it: unknown) => unknown) {
    class SafeIterator {
      _iterator: unknown;
      constructor(iterable: unknown) {
        this._iterator = factory(iterable);
      }
      next() {
        return next(this._iterator);
      }
      [Symbol.iterator]() {
        return this;
      }
    }
    Object.setPrototypeOf(SafeIterator.prototype, null);
    Object.freeze(SafeIterator.prototype);
    Object.freeze(SafeIterator);
    return SafeIterator;
  }
  /** Node's `makeSafe`. */
  function makeSafe<T extends { prototype: object }>(unsafe: T, safe: T): T {
    const copyProps = (src: object, dest: object) => {
      for (const key of Reflect.ownKeys(src))
        if (!Reflect.getOwnPropertyDescriptor(dest, key))
          Reflect.defineProperty(dest, key, {
            __proto__: null,
            ...Reflect.getOwnPropertyDescriptor(src, key),
          } as PropertyDescriptor);
    };
    if (Symbol.iterator in unsafe.prototype) {
      const dummy = new (unsafe as unknown as new () => object)();
      let next: ((it: unknown) => unknown) | undefined;
      for (const key of Reflect.ownKeys(unsafe.prototype)) {
        if (Reflect.getOwnPropertyDescriptor(safe.prototype, key)) continue;
        const desc = Reflect.getOwnPropertyDescriptor(unsafe.prototype, key) as PropertyDescriptor;
        if (
          typeof desc.value === 'function' &&
          desc.value.length === 0 &&
          Symbol.iterator in ((call.call(desc.value, dummy) as object) ?? {})
        ) {
          const createIterator = uncurry(desc.value);
          next ??= uncurry((createIterator(dummy) as { next: Fn }).next);
          const SafeIterator = createSafeIterator(createIterator, next);
          desc.value = function (this: unknown) {
            return new SafeIterator(this);
          };
        }
        Reflect.defineProperty(safe.prototype, key, {
          __proto__: null,
          ...desc,
        } as PropertyDescriptor);
      }
    } else copyProps(unsafe.prototype, safe.prototype);
    copyProps(unsafe, safe);
    Object.setPrototypeOf(safe.prototype, null);
    Object.freeze(safe.prototype);
    Object.freeze(safe);
    return safe;
  }
  const SafePromise = makeSafe(Promise, class SafePromise<T> extends Promise<T> {});
  const PromisePrototypeThen = uncurry(Promise.prototype.then);

  const primordials: Mod = {
    AggregateError,
    Array,
    ArrayIsArray: Array.isArray,
    ArrayPrototypeFilter: uncurry(Array.prototype.filter),
    ArrayPrototypeIncludes: uncurry(Array.prototype.includes),
    ArrayPrototypeIndexOf: uncurry(Array.prototype.indexOf),
    ArrayPrototypeJoin: uncurry(Array.prototype.join),
    ArrayPrototypeMap: uncurry(Array.prototype.map),
    ArrayPrototypePop: uncurry(Array.prototype.pop),
    ArrayPrototypePush: uncurry(Array.prototype.push),
    ArrayPrototypeSlice: uncurry(Array.prototype.slice),
    ArrayPrototypeSplice: uncurry(Array.prototype.splice),
    ArrayPrototypeUnshift: uncurry(Array.prototype.unshift),
    Boolean,
    Error,
    ErrorCaptureStackTrace: (Error as unknown as { captureStackTrace: Fn }).captureStackTrace,
    FunctionPrototypeBind: uncurry(Function.prototype.bind),
    FunctionPrototypeCall: uncurry(Function.prototype.call),
    FunctionPrototypeSymbolHasInstance: uncurry(Function.prototype[Symbol.hasInstance]),
    JSONStringify: JSON.stringify,
    MapPrototypeGet: uncurry(Map.prototype.get),
    MathAbs: Math.abs,
    MathFloor: Math.floor,
    MathMin: Math.min,
    Number,
    NumberIsInteger: Number.isInteger,
    NumberIsNaN: Number.isNaN,
    NumberMAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
    NumberMIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
    NumberParseInt: Number.parseInt,
    ObjectDefineProperties: Object.defineProperties,
    ObjectDefineProperty: Object.defineProperty,
    ObjectFreeze: Object.freeze,
    ObjectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    ObjectGetOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
    ObjectGetPrototypeOf: Object.getPrototypeOf,
    ObjectIs: Object.is,
    ObjectIsExtensible: Object.isExtensible,
    ObjectKeys: Object.keys,
    ObjectPrototypeHasOwnProperty: uncurry(Object.prototype.hasOwnProperty),
    ObjectSetPrototypeOf: Object.setPrototypeOf,
    ObjectValues: Object.values,
    Promise,
    PromisePrototypeThen,
    PromiseReject: Promise.reject.bind(Promise),
    PromiseResolve: Promise.resolve.bind(Promise),
    PromiseWithResolvers: (Promise as unknown as { withResolvers: Fn }).withResolvers.bind(Promise),
    RangeError,
    ReflectApply: Reflect.apply,
    ReflectConstruct: Reflect.construct,
    ReflectOwnKeys: Reflect.ownKeys,
    RegExpPrototypeExec: uncurry(RegExp.prototype.exec),
    SafeArrayIterator: createSafeIterator(
      uncurry(Array.prototype[Symbol.iterator]),
      ArrayIteratorPrototypeNext,
    ),
    SafeMap: makeSafe(Map, class SafeMap<K, V> extends Map<K, V> {}),
    SafePromiseAllReturnVoid: (
      promises: ArrayLike<unknown>,
      mapFn?: (p: unknown, i: number) => unknown,
    ) =>
      new Promise<void>((resolve, reject) => {
        let pendingPromises = promises.length;
        if (pendingPromises === 0) resolve();
        const onFulfilled = () => {
          if (--pendingPromises === 0) resolve();
        };
        for (let i = 0; i < promises.length; i++) {
          const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
          PromisePrototypeThen(Promise.resolve(promise), onFulfilled, reject);
        }
      }),
    SafePromisePrototypeFinally: (thisPromise: Promise<unknown>, onFinally: () => void) =>
      new Promise((a, b) =>
        new SafePromise((a2, b2) => PromisePrototypeThen(thisPromise, a2, b2))
          .finally(onFinally)
          .then(a, b),
      ),
    SafeSet: makeSafe(Set, class SafeSet<T> extends Set<T> {}),
    String,
    StringPrototypeEndsWith: uncurry(String.prototype.endsWith),
    StringPrototypeIncludes: uncurry(String.prototype.includes),
    StringPrototypeIndexOf: uncurry(String.prototype.indexOf),
    StringPrototypeSlice: uncurry(String.prototype.slice),
    StringPrototypeStartsWith: uncurry(String.prototype.startsWith),
    StringPrototypeToLowerCase: uncurry(String.prototype.toLowerCase),
    Symbol,
    SymbolAsyncDispose: (Symbol as unknown as { asyncDispose: symbol }).asyncDispose,
    SymbolAsyncIterator: Symbol.asyncIterator,
    SymbolDispose: (Symbol as unknown as { dispose: symbol }).dispose,
    SymbolFor: Symbol.for,
    SymbolHasInstance: Symbol.hasInstance,
    SymbolIterator: Symbol.iterator,
    SymbolSpecies: Symbol.species,
    TypeError,
    TypedArrayPrototypeGetBuffer: getter(TypedArray.prototype, 'buffer'),
    TypedArrayPrototypeGetByteLength: getter(TypedArray.prototype, 'byteLength'),
    TypedArrayPrototypeGetByteOffset: getter(TypedArray.prototype, 'byteOffset'),
    TypedArrayPrototypeGetSymbolToStringTag: getter(TypedArray.prototype, Symbol.toStringTag),
    TypedArrayPrototypeIncludes: uncurry((TypedArray.prototype as { includes: Fn }).includes),
    TypedArrayPrototypeSet: uncurry((TypedArray.prototype as { set: Fn }).set),
    Uint8Array,
  };
  Object.setPrototypeOf(primordials, null);
  return Object.freeze(primordials);
}

export function createRouteB(createNodeStreams: CreateNodeStreams, host: RouteBHost) {
  const abByteLength = getter(ArrayBuffer.prototype, 'byteLength');
  const sabByteLength =
    typeof SharedArrayBuffer === 'function'
      ? getter(SharedArrayBuffer.prototype, 'byteLength')
      : undefined;
  const branded = (get: ((v: unknown) => unknown) | undefined, v: unknown) => {
    if (get === undefined) return false;
    try {
      get(v);
      return true;
    } catch {
      return false;
    }
  };
  /** A brand check through a prototype getter that throws on a foreign receiver. */
  const brandOf = (C: { prototype: object } | undefined, key: string) => {
    const get = C && getter(C.prototype, key);
    return (v: unknown) => branded(get, v);
  };
  const primordials = makePrimordials();
  const toStringTag = primordials.TypedArrayPrototypeGetSymbolToStringTag as (
    v: unknown,
  ) => unknown;
  const gap = (feature: string) => () => {
    throw new host.NotImplementedError(feature);
  };
  const rifty = (id: string) => {
    const m = host.module(id);
    if (m === undefined) throw new Error(`route B: node:${id} is not loaded in this realm`);
    return m as Mod;
  };
  const util = () => rifty('util');
  const types = () =>
    util().types as { isNativeError(v: unknown): boolean; isPromise(v: unknown): boolean };
  const g = globalThis as unknown as Mod;
  const MODULES: Record<string, () => unknown> = {
    async_hooks: () =>
      host.module('async_hooks') ?? {
        // runtime-js misc-stubs.ts's AsyncResource: no async context to carry.
        AsyncResource: class AsyncResource {
          runInAsyncScope(fn: Fn, thisArg: unknown, ...args: never[]) {
            return Reflect.apply(fn, thisArg, args);
          }
        },
      },
    buffer: () => rifty('buffer'),
    events: () => rifty('events'),
    fs: () => rifty('fs'),
    string_decoder: () => rifty('string_decoder'),
    url: () => rifty('url'),
    util,
    'internal/abort_controller': () => ({
      AbortController: g.AbortController,
      AbortSignal: g.AbortSignal,
    }),
    'internal/blob': () => ({
      isBlob: (v: unknown) =>
        typeof g.Blob === 'function' && v instanceof (g.Blob as new () => object),
    }),
    // Node's FastBuffer is a Uint8Array subclass sharing Buffer.prototype; rifty's Buffer is that class.
    'internal/buffer': () => ({ FastBuffer: rifty('buffer').Buffer }),
    'internal/encoding': () => ({ TextEncoder: g.TextEncoder }),
    // Variant B only (generate.mjs ABORT=derived; the default, variant A, generates Node's file):
    // Node's addAbortListener attaches with kResistStopPropagation, which a host EventTarget ignores:
    // a guest listener that stops immediate propagation would hide the abort (S1). A dependent signal
    // is aborted by the abort algorithm, not by a listener, so it cannot be stopped. Without
    // AbortSignal.any (Chromium < 116) the plain listener stays: a declared gap there.
    'internal/events/abort_listener': () => ({
      addAbortListener(signal: AbortSignal | undefined, listener: () => void) {
        const v = nodeReq('internal/validators') as Record<string, (x: unknown, n: string) => void>;
        if (signal === undefined) {
          const { ERR_INVALID_ARG_TYPE } = (
            nodeReq('internal/errors') as { codes: Record<string, new (...a: unknown[]) => Error> }
          ).codes;
          throw new ERR_INVALID_ARG_TYPE('signal', 'AbortSignal', signal);
        }
        v.validateAbortSignal(signal, 'signal');
        v.validateFunction(listener, 'listener');
        let remove: (() => void) | undefined;
        if (signal.aborted) {
          g.queueMicrotask(() => listener());
        } else {
          const any = (g.AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
          // Only a host AbortSignal gets a dependent; a signal-like object keeps Node's own call (and
          // its V8 TypeError text, which names `signal`).
          if (any && signal instanceof (g.AbortSignal as typeof AbortSignal)) {
            const dependent = any([signal]);
            dependent.addEventListener('abort', listener, { once: true });
            remove = () => dependent.removeEventListener('abort', listener);
          } else {
            signal.addEventListener('abort', listener, { once: true });
            remove = () => signal.removeEventListener('abort', listener);
          }
        }
        return {
          __proto__: null,
          [Symbol.dispose]() {
            remove?.();
          },
        };
      },
    }),
    'internal/event_target': () => ({
      kWeakHandler: Symbol('kWeak'),
      kResistStopPropagation: Symbol('kResistStopPropagation'),
    }),
    'internal/fs/promises': () => ({
      // Named gap: nothing is a FileHandle, so an `fd: FileHandle` option is refused (Node accepts it).
      FileHandle: Object.defineProperty(function FileHandle() {}, Symbol.hasInstance, {
        value: () => false,
      }),
      kRef: Symbol('kRef'),
      kUnref: Symbol('kUnref'),
    }),
    'internal/process/task_queues': () => ({ queueMicrotask: g.queueMicrotask }),
    'internal/process/warning': () => ({ emitWarningSync: gap('process.emitWarningSync') }),
    'internal/util/debuglog': () => ({
      debuglog: (set: string, cb?: Fn) => {
        let fn: Fn | undefined;
        return (...args: never[]) => {
          const u = host.module('util') as Mod | undefined;
          fn ??= u ? (u.debuglog as (s: string, c?: Fn) => Fn)(set, cb) : () => {};
          return fn(...args);
        };
      },
    }),
    'internal/util/inspect': () => ({ inspect: util().inspect, format: util().format }),
    'internal/util/types': () => ({
      isAnyArrayBuffer: (v: unknown) => branded(abByteLength, v) || branded(sabByteLength, v),
      isArrayBufferView: ArrayBuffer.isView,
      isUint8Array: (v: unknown) => toStringTag(v) === 'Uint8Array',
    }),
    'internal/v8/startup_snapshot': () => ({ namespace: { isBuildingSnapshot: () => false } }),
    'internal/webstreams/queuingstrategies': () => ({
      ByteLengthQueuingStrategy: g.ByteLengthQueuingStrategy,
      CountQueuingStrategy: g.CountQueuingStrategy,
    }),
    'internal/webstreams/readablestream': () => ({
      ReadableStream: g.ReadableStream,
      isReadableStream: brandOf(g.ReadableStream as { prototype: object }, 'locked'),
    }),
    'internal/webstreams/writablestream': () => ({
      WritableStream: g.WritableStream,
      isWritableStream: brandOf(g.WritableStream as { prototype: object }, 'locked'),
    }),
  };
  const streamBase = class {
    constructor() {
      throw new host.NotImplementedError('stream.web.StreamBase');
    }
  };
  const INTERNAL: Record<string, () => unknown> = {
    constants: () => ({
      get zlib() {
        return rifty('zlib').constants;
      },
    }),
    stream_wrap: () => ({
      WriteWrap: streamBase,
      ShutdownWrap: streamBase,
      kReadBytesOrError: 0,
      kLastWriteWasAsync: 1,
      streamBaseState: new Int32Array(2),
    }),
    types: () => ({
      isNativeError: (v: unknown) => types().isNativeError(v),
      isPromise: (v: unknown) => types().isPromise(v),
    }),
    uv: () => ({ UV_EOF: -4095, errname: gap('uv.errname'), getErrorMap: gap('uv.getErrorMap') }),
  };
  const lookup = (table: Record<string, () => unknown>, kind: string) => {
    const cache = new Map<string, unknown>();
    return (id: string) => {
      if (!cache.has(id)) {
        const make = table[id];
        if (!make) throw new Error(`route B: no ${kind} ${id}`);
        cache.set(id, make());
      }
      return cache.get(id);
    };
  };
  // The generated modules' own require, for bindings that reuse Node's code (validators, errors).
  let nodeReq: (id: string) => unknown = () => {
    throw new Error('route B: generated modules not created yet');
  };
  nodeReq = createNodeStreams(
    primordials,
    lookup(INTERNAL, 'internalBinding'),
    lookup(MODULES, 'binding'),
    host.process,
  );
  return nodeReq;
}
