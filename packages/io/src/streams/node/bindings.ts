/**
 * Bindings of Node v24.16.0's generated stream core (ADR-0575 §2; `generated/node-streams.js`):
 * what its modules read outside the generated set — `primordials`, `internalBinding(id)`,
 * `require(id)`, `process`. Each repeats Node's binding (per-context `primordials.js`,
 * `internal/*`, the C++ binding), not an analogue. Nothing else here is hand-written.
 *
 * - Intrinsics and host globals are captured when this module evaluates (before guest code, as
 *   Node's per-context primordials), so a guest's later `Array.prototype.push = …` or
 *   `globalThis.Promise = …` does not reach the core; nothing below reads a live intrinsic at
 *   call time.
 * - rifty modules (`buffer`, `events`, `fs`, `string_decoder`, `url`, `util`, `util/types`,
 *   `async_hooks`, `process`) through the builtin registry, when the core first reads them; one
 *   not registered throws by name.
 * - Named gaps: `internal/event_target`'s `kResistStopPropagation`/`kWeakHandler` are fresh symbols a
 *   host `EventTarget` ignores (`runtime-js/stream-core-abort-listeners-host-event-target`);
 *   `FileHandle` (no rifty one: nothing is an instance); StreamBase handles (`stream_wrap`),
 *   `uv.errname`/`getErrorMap`, `emitWarningSync` throw `NotImplementedError` — no path the core
 *   runs without a native handle reaches them.
 *
 * Not imported by any product module until unit 8c (`check:arch`
 * `node-stream-core-has-no-production-importer`).
 */
import { loadBuiltin, readBuiltinUncached } from '../../builtin-registry.ts';
import { NotImplementedError } from '../../errors.ts';
import createNodeStreamCore from './generated/node-streams.js';
import { ZLIB_CONSTANTS } from './zlib-constants.ts';

type Fn = (...args: never[]) => unknown;
type Mod = Record<string, unknown>;
type Uncurried = (self: unknown, ...args: unknown[]) => unknown;
type Table = Readonly<Record<string, () => unknown>>;

/**
 * The primordials the core reads (`generated/node-streams.js` `PRIMORDIALS`), each built as Node's
 * `lib/internal/per_context/primordials.js` builds it.
 */
export function makePrimordials(): Readonly<Mod> {
  const { bind, call } = Function.prototype;
  // Node: `bind.bind(call)`, so a later `Function.prototype.call/bind` patch cannot reach it.
  const uncurryThis = bind.bind(call) as unknown as (fn: unknown) => Uncurried;
  const ReflectApply = Reflect.apply;
  const ReflectDefineProperty = Reflect.defineProperty;
  const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
  const ReflectOwnKeys = Reflect.ownKeys;
  const ObjectSetPrototypeOf = Object.setPrototypeOf;
  const ObjectFreeze = Object.freeze;
  const SymbolIterator: typeof Symbol.iterator = Symbol.iterator;
  const { Promise } = globalThis;
  const PromiseResolve = Promise.resolve.bind(Promise);
  const PromisePrototypeThen = uncurryThis(Promise.prototype.then);
  const ArrayPrototypeForEach = uncurryThis(Array.prototype.forEach);
  const getter = (proto: object, key: PropertyKey): Uncurried =>
    uncurryThis(ReflectGetOwnPropertyDescriptor(proto, key)?.get);
  const TypedArray = Reflect.getPrototypeOf(Uint8Array) as { prototype: object };
  const ArrayIteratorPrototypeNext = uncurryThis(
    (Reflect.getPrototypeOf([][SymbolIterator]()) as { next: Fn }).next,
  );

  /** Node's `createSafeIterator`. */
  const createSafeIterator = (factory: Uncurried, next: Uncurried) => {
    class SafeIterator {
      _iterator: unknown;
      constructor(iterable: unknown) {
        this._iterator = factory(iterable);
      }
      next() {
        return next(this._iterator);
      }
      [SymbolIterator]() {
        return this;
      }
    }
    ObjectSetPrototypeOf(SafeIterator.prototype, null);
    ObjectFreeze(SafeIterator.prototype);
    ObjectFreeze(SafeIterator);
    return SafeIterator;
  };
  /** Node's `copyProps`. */
  const copyProps = (src: object, dest: object) => {
    ArrayPrototypeForEach(ReflectOwnKeys(src), (key: PropertyKey) => {
      if (!ReflectGetOwnPropertyDescriptor(dest, key)) {
        ReflectDefineProperty(dest, key, {
          __proto__: null,
          ...ReflectGetOwnPropertyDescriptor(src, key),
        } as PropertyDescriptor);
      }
    });
  };
  /** Node's `makeSafe`. */
  const makeSafe = <T extends { prototype: object }>(unsafe: T, safe: T): T => {
    if (SymbolIterator in unsafe.prototype) {
      const dummy = new (unsafe as unknown as new () => object)();
      let next: Uncurried | undefined;
      ArrayPrototypeForEach(ReflectOwnKeys(unsafe.prototype), (key: PropertyKey) => {
        if (!ReflectGetOwnPropertyDescriptor(safe.prototype, key)) {
          const desc = ReflectGetOwnPropertyDescriptor(unsafe.prototype, key) as PropertyDescriptor;
          if (
            typeof desc.value === 'function' &&
            desc.value.length === 0 &&
            SymbolIterator in ((ReflectApply(desc.value, dummy, []) as object) ?? {})
          ) {
            const createIterator = uncurryThis(desc.value);
            next ??= uncurryThis((createIterator(dummy) as { next: Fn }).next);
            const SafeIterator = createSafeIterator(createIterator, next);
            desc.value = function (this: unknown) {
              return new SafeIterator(this);
            };
          }
          ReflectDefineProperty(safe.prototype, key, {
            __proto__: null,
            ...desc,
          } as PropertyDescriptor);
        }
      });
    } else {
      copyProps(unsafe.prototype, safe.prototype);
    }
    copyProps(unsafe, safe);
    ObjectSetPrototypeOf(safe.prototype, null);
    ObjectFreeze(safe.prototype);
    ObjectFreeze(safe);
    return safe;
  };
  const SafePromise = makeSafe(Promise, class SafePromise<T> extends Promise<T> {});
  const withResolvers = (Promise as unknown as { withResolvers?: Fn }).withResolvers;

  const primordials: Mod = {
    AggregateError,
    Array,
    ArrayIsArray: Array.isArray,
    ArrayPrototypeFilter: uncurryThis(Array.prototype.filter),
    ArrayPrototypeIncludes: uncurryThis(Array.prototype.includes),
    ArrayPrototypeIndexOf: uncurryThis(Array.prototype.indexOf),
    ArrayPrototypeJoin: uncurryThis(Array.prototype.join),
    ArrayPrototypeMap: uncurryThis(Array.prototype.map),
    ArrayPrototypePop: uncurryThis(Array.prototype.pop),
    ArrayPrototypePush: uncurryThis(Array.prototype.push),
    ArrayPrototypeSlice: uncurryThis(Array.prototype.slice),
    ArrayPrototypeSplice: uncurryThis(Array.prototype.splice),
    ArrayPrototypeUnshift: uncurryThis(Array.prototype.unshift),
    Boolean,
    Error,
    ErrorCaptureStackTrace: (Error as unknown as { captureStackTrace: Fn }).captureStackTrace,
    FunctionPrototypeBind: uncurryThis(Function.prototype.bind),
    FunctionPrototypeCall: uncurryThis(Function.prototype.call),
    FunctionPrototypeSymbolHasInstance: uncurryThis(Function.prototype[Symbol.hasInstance]),
    JSONStringify: JSON.stringify,
    MapPrototypeGet: uncurryThis(Map.prototype.get),
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
    ObjectFreeze,
    ObjectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    ObjectGetOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
    ObjectGetPrototypeOf: Object.getPrototypeOf,
    ObjectIs: Object.is,
    ObjectIsExtensible: Object.isExtensible,
    ObjectKeys: Object.keys,
    ObjectPrototypeHasOwnProperty: uncurryThis(Object.prototype.hasOwnProperty),
    ObjectSetPrototypeOf,
    ObjectValues: Object.values,
    Promise,
    PromisePrototypeThen,
    PromiseReject: Promise.reject.bind(Promise),
    PromiseResolve,
    // Absent below Chromium 119 (Node always has it): `undefined`, and creating the core then
    // throws by name (`node-streams: no primordial`) — the ES floor is 8c's (ADR-0575 §2).
    PromiseWithResolvers: withResolvers === undefined ? undefined : withResolvers.bind(Promise),
    RangeError,
    ReflectApply,
    ReflectConstruct: Reflect.construct,
    ReflectOwnKeys,
    RegExpPrototypeExec: uncurryThis(RegExp.prototype.exec),
    SafeArrayIterator: createSafeIterator(
      uncurryThis(Array.prototype[SymbolIterator]),
      ArrayIteratorPrototypeNext,
    ),
    SafeMap: makeSafe(Map, class SafeMap<K, V> extends Map<K, V> {}),
    SafeSet: makeSafe(Set, class SafeSet<T> extends Set<T> {}),
    String,
    StringPrototypeEndsWith: uncurryThis(String.prototype.endsWith),
    StringPrototypeIncludes: uncurryThis(String.prototype.includes),
    StringPrototypeIndexOf: uncurryThis(String.prototype.indexOf),
    StringPrototypeSlice: uncurryThis(String.prototype.slice),
    StringPrototypeStartsWith: uncurryThis(String.prototype.startsWith),
    StringPrototypeToLowerCase: uncurryThis(String.prototype.toLowerCase),
    Symbol,
    SymbolAsyncDispose: (Symbol as unknown as { asyncDispose?: symbol }).asyncDispose,
    SymbolAsyncIterator: Symbol.asyncIterator,
    SymbolDispose: (Symbol as unknown as { dispose?: symbol }).dispose,
    SymbolFor: Symbol.for,
    SymbolHasInstance: Symbol.hasInstance,
    SymbolIterator,
    SymbolSpecies: Symbol.species,
    TypeError,
    TypedArrayPrototypeGetBuffer: getter(TypedArray.prototype, 'buffer'),
    TypedArrayPrototypeGetByteLength: getter(TypedArray.prototype, 'byteLength'),
    TypedArrayPrototypeGetByteOffset: getter(TypedArray.prototype, 'byteOffset'),
    TypedArrayPrototypeGetSymbolToStringTag: getter(TypedArray.prototype, Symbol.toStringTag),
    TypedArrayPrototypeIncludes: uncurryThis((TypedArray.prototype as { includes: Fn }).includes),
    TypedArrayPrototypeSet: uncurryThis((TypedArray.prototype as { set: Fn }).set),
    Uint8Array,
  };
  // Node assigns these to the object (an arrow gets no inferred name): so here.
  primordials.SafePromiseAllReturnVoid = (
    promises: ArrayLike<unknown>,
    mapFn?: (p: unknown, i: number) => unknown,
  ) =>
    new Promise<void>((resolve, reject) => {
      let pendingPromises = promises.length;
      if (pendingPromises === 0) resolve();
      const onFulfilled = () => {
        if (--pendingPromises === 0) {
          resolve();
        }
      };
      for (let i = 0; i < promises.length; i++) {
        const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
        PromisePrototypeThen(PromiseResolve(promise), onFulfilled, reject);
      }
    });
  // The new Promise keeps SafePromise out of user land.
  primordials.SafePromisePrototypeFinally = (
    thisPromise: Promise<unknown>,
    onFinally: () => void,
  ) =>
    new Promise((a, b) =>
      new SafePromise((a2, b2) => PromisePrototypeThen(thisPromise, a2, b2))
        .finally(onFinally)
        .then(a, b),
    );
  ObjectSetPrototypeOf(primordials, null);
  return ObjectFreeze(primordials);
}

/** Captured when this module evaluates (a pure call: dropped by a bundle that never reads it). */
export const primordials = /* @__PURE__ */ makePrimordials();

/** Host globals the bindings hand to the core, captured with the primordials. */
function captureHost() {
  const g = globalThis as unknown as Record<string, unknown>;
  const FunctionPrototypeCall = primordials.FunctionPrototypeCall as Uncurried;
  /** A prototype getter as `(value) => …`; it throws on a value without the slot it reads. */
  const getterOf = (C: unknown, key: string): Uncurried | undefined => {
    const get =
      typeof C === 'function'
        ? Reflect.getOwnPropertyDescriptor((C as { prototype: object }).prototype, key)?.get
        : undefined;
    return get === undefined ? undefined : (value) => FunctionPrototypeCall(get, value);
  };
  return {
    AbortController: g.AbortController,
    AbortSignal: g.AbortSignal,
    TextEncoder: g.TextEncoder,
    ReadableStream: g.ReadableStream,
    WritableStream: g.WritableStream,
    ByteLengthQueuingStrategy: g.ByteLengthQueuingStrategy,
    CountQueuingStrategy: g.CountQueuingStrategy,
    queueMicrotask: g.queueMicrotask,
    Int32Array,
    blobSize: getterOf(g.Blob, 'size'),
    readableLocked: getterOf(g.ReadableStream, 'locked'),
    writableLocked: getterOf(g.WritableStream, 'locked'),
    arrayBufferByteLength: getterOf(ArrayBuffer, 'byteLength'),
    sharedArrayBufferByteLength: getterOf(g.SharedArrayBuffer, 'byteLength'),
    arrayBufferIsView: ArrayBuffer.isView,
  };
}
const host = /* @__PURE__ */ captureHost();

const { ReflectApply } = primordials as { ReflectApply: typeof Reflect.apply };
const {
  Symbol: SymbolCtor,
  SymbolHasInstance,
  SymbolSpecies,
} = primordials as {
  Symbol: SymbolConstructor;
  SymbolHasInstance: symbol;
  SymbolSpecies: symbol;
};
const toStringTag = primordials.TypedArrayPrototypeGetSymbolToStringTag as Uncurried;
/** True when `get(value)` does not throw: `value` carries the slot the getter checks. */
function branded(get: Uncurried | undefined, value: unknown): boolean {
  if (get === undefined) return false;
  try {
    get(value);
    return true;
  } catch {
    return false;
  }
}
const gap = (feature: string) => () => {
  throw new NotImplementedError(feature);
};
/** A class whose construction is a named gap (a StreamBase handle rifty has no native for). */
const gapClass = (feature: string) =>
  class {
    constructor() {
      throw new NotImplementedError(feature);
    }
  };

function rifty(id: string): Mod {
  const m = loadBuiltin(id);
  if (m === null) throw new Error(`node-streams: node:${id} is not registered in this realm`);
  return m;
}
/** The active process at call time (ADR-0458: read through the registry factory, uncached). */
function active(): Mod {
  const p = readBuiltinUncached('process');
  if (p === null) throw new Error('node-streams: node:process is not registered in this realm');
  return p;
}
/** `process` as the core reads it: `nextTick`, `emitWarning`, `platform`, `noDeprecation`, `stdout`, `stderr`. */
const processBinding = {
  nextTick(...args: unknown[]): unknown {
    const p = active();
    return ReflectApply(p.nextTick as Fn, p, args);
  },
  emitWarning(...args: unknown[]): unknown {
    const p = active();
    return ReflectApply(p.emitWarning as Fn, p, args);
  },
  get platform(): unknown {
    return active().platform;
  },
  get noDeprecation(): unknown {
    return active().noDeprecation;
  },
  get stdout(): unknown {
    return active().stdout;
  },
  get stderr(): unknown {
    return active().stderr;
  },
};

/** `require(id)` of an id outside the generated set (the generator's `EXPECTED.bindings`). */
const MODULES = {
  __proto__: null,
  async_hooks: () => rifty('async_hooks'),
  buffer: () => rifty('buffer'),
  events: () => rifty('events'),
  fs: () => rifty('fs'),
  string_decoder: () => rifty('string_decoder'),
  url: () => rifty('url'),
  util: () => rifty('util'),
  'internal/abort_controller': () => ({
    AbortController: host.AbortController,
    AbortSignal: host.AbortSignal,
  }),
  // Node: `object?.[kHandle] !== undefined`, the brand of its own Blob; here the host's (or the
  // isolate's Node) Blob brand.
  'internal/blob': () => ({ isBlob: (object: unknown) => branded(host.blobSize, object) }),
  // Node: `Buffer[SymbolSpecies] === FastBuffer` (readable.js:94 reads it so).
  'internal/buffer': () => ({
    FastBuffer: (rifty('buffer').Buffer as Record<symbol, unknown>)[SymbolSpecies],
  }),
  'internal/encoding': () => ({ TextEncoder: host.TextEncoder }),
  'internal/event_target': () => ({
    kResistStopPropagation: SymbolCtor('kResistStopPropagation'),
    kWeakHandler: SymbolCtor('kWeak'),
  }),
  'internal/fs/promises': () => ({
    FileHandle: class FileHandle {
      constructor() {
        throw new NotImplementedError('fs.promises.FileHandle');
      }
      static [SymbolHasInstance](): boolean {
        return false;
      }
    },
    kRef: SymbolCtor('kRef'),
    kUnref: SymbolCtor('kUnref'),
  }),
  'internal/process/task_queues': () => ({ queueMicrotask: host.queueMicrotask }),
  'internal/process/warning': () => ({ emitWarningSync: gap('process.emitWarningSync') }),
  // Node's public `util.debuglog` is this function; rifty's `util.debuglog`.
  'internal/util/debuglog': () => ({ debuglog: rifty('util').debuglog }),
  'internal/util/inspect': () => {
    const u = rifty('util');
    return { inspect: u.inspect, format: u.format };
  },
  // Node's internal/util/types.js: `isUint8Array` by the TypedArray tag getter,
  // `isArrayBufferView` = `ArrayBufferIsView`; `isAnyArrayBuffer` (C++) by the byteLength brands.
  'internal/util/types': () => ({
    isAnyArrayBuffer: (value: unknown) =>
      branded(host.arrayBufferByteLength, value) ||
      branded(host.sharedArrayBufferByteLength, value),
    isArrayBufferView: host.arrayBufferIsView,
    isUint8Array: (value: unknown) => toStringTag(value) === 'Uint8Array',
  }),
  // rifty never builds a startup snapshot.
  'internal/v8/startup_snapshot': () => ({ namespace: { isBuildingSnapshot: () => false } }),
  'internal/webstreams/queuingstrategies': () => ({
    ByteLengthQueuingStrategy: host.ByteLengthQueuingStrategy,
    CountQueuingStrategy: host.CountQueuingStrategy,
  }),
  'internal/webstreams/readablestream': () => ({
    ReadableStream: host.ReadableStream,
    isReadableStream: (value: unknown) => branded(host.readableLocked, value),
  }),
  'internal/webstreams/writablestream': () => ({
    WritableStream: host.WritableStream,
    isWritableStream: (value: unknown) => branded(host.writableLocked, value),
  }),
} as unknown as Table;
/** `internalBinding(id)` (the generator's `EXPECTED.internalBindings`). */
const INTERNAL = {
  __proto__: null,
  // Only `.zlib` is read (adapters.js:94); the data, no zlib module.
  constants: () => ({ zlib: ZLIB_CONSTANTS }),
  // StreamBase handles: Node's field indices (src/stream_base.h), no native handle to wrap.
  stream_wrap: () => ({
    WriteWrap: gapClass('stream_wrap.WriteWrap'),
    ShutdownWrap: gapClass('stream_wrap.ShutdownWrap'),
    kReadBytesOrError: 0,
    kArrayBufferOffset: 1,
    kBytesWritten: 2,
    kLastWriteWasAsync: 3,
    streamBaseState: new host.Int32Array(4),
  }),
  // C++ IsNativeError/IsPromise: rifty's `util.types` (its declared brand approximation).
  types: () => {
    const t = rifty('util/types');
    return { isNativeError: t.isNativeError, isPromise: t.isPromise };
  },
  uv: () => ({ UV_EOF: -4095, errname: gap('uv.errname'), getErrorMap: gap('uv.getErrorMap') }),
} as unknown as Table;

/** The ids the tables bind (the test holds them to the generated `BINDINGS`/`INTERNAL_BINDINGS`). */
export const boundIds = (): { modules: string[]; internalBindings: string[] } => ({
  modules: Object.keys(MODULES).sort(),
  internalBindings: Object.keys(INTERNAL).sort(),
});

const cached = (table: Table, kind: string) => {
  const done: Record<string, unknown> = { __proto__: null } as unknown as Record<string, unknown>;
  return (id: string): unknown => {
    if (id in done) return done[id];
    const make = table[id];
    if (make === undefined) throw new Error(`node-streams: no ${kind} ${id}`);
    const value = make();
    done[id] = value;
    return value;
  };
};

let load: ((id: string) => unknown) | undefined;
/**
 * A module of the generated core by Node's id (`stream`, `stream/promises`, `internal/fs/streams`,
 * …), the core created on first read.
 */
export function nodeStreamModule(id: string): unknown {
  load ??= createNodeStreamCore(
    primordials,
    cached(INTERNAL, 'internalBinding'),
    cached(MODULES, 'binding'),
    processBinding,
  );
  return load(id);
}
