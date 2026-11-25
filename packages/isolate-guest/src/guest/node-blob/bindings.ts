import { setImmediate } from '@riftydev/runtime-js/builtins/timers';
/**
 * Inputs of Node v24.16.0's generated `internal/webidl`/`blob`/`file` (ADR-0578 §2–§4):
 * `primordials` captured at bundle load (before guest code), Node's error classes and the one
 * validator they throw through, the JS byte store, and the guest's own codec, inspect,
 * `DOMException`, microtask queue and immediates. Everything else is upstream's text.
 */
import { describeReceived, inspect } from '@riftydev/runtime-js/internal';
import { notImplemented } from '../loud.ts';
import { TextDecoder, TextEncoder } from '../text-codec.ts';
import { DOMException, queueMicrotask } from '../web-shim.ts';
import { blobBinding } from './byte-store.ts';
import createNodeBlob from './generated/node-blob.js';

type Fn = (...args: never[]) => unknown;
const apply = Reflect.apply;
const uncurry =
  <T extends Fn>(f: T) =>
  (self: unknown, ...args: Parameters<T>): ReturnType<T> =>
    apply(f, self, args) as ReturnType<T>;
const getter = (proto: object, key: PropertyKey) =>
  Object.getOwnPropertyDescriptor(proto, key)?.get as Fn;
const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;

const setProto = Set.prototype;
/** Node's `SafeSet`: a `Set` whose methods are the ones captured here. */
class SafeSet<T> extends Set<T> {}
for (const key of Reflect.ownKeys(setProto)) {
  if (key === 'constructor') continue;
  const desc = Reflect.getOwnPropertyDescriptor(setProto, key);
  if (desc) Reflect.defineProperty(SafeSet.prototype, key, desc);
}

const PromiseCtor = Promise;
const promiseReject = Promise.reject;
const arraySlice = Array.prototype.slice;
const arraySort = Array.prototype.sort;
const charCodeAt = String.prototype.charCodeAt;
const sliceString = String.prototype.slice;
// ES2023/2024 primordials as their ES2022 equivalents (the shipped-bundle floor, ADR-0469).
/** `String.prototype.toWellFormed`: each lone surrogate → U+FFFD; no guest-replaceable lookup. */
function toWellFormed(string: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < string.length; i++) {
    const unit = apply(charCodeAt, string, [i]) as number;
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit <= 0xdbff && i + 1 < string.length) {
      const next = apply(charCodeAt, string, [i + 1]) as number;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    }
    out += `${apply(sliceString, string, [from, i])}\uFFFD`;
    from = i + 1;
  }
  return from === 0 ? string : out + apply(sliceString, string, [from]);
}
const primordials = {
  ArrayBufferIsView: ArrayBuffer.isView,
  ArrayBufferPrototypeGetByteLength: uncurry(getter(ArrayBuffer.prototype, 'byteLength')),
  ArrayPrototypePush: uncurry(Array.prototype.push),
  ArrayPrototypeToSorted: (array: unknown[], compare?: Fn) =>
    apply(arraySort, apply(arraySlice, array, []), [compare]),
  DataViewPrototypeGetBuffer: uncurry(getter(DataView.prototype, 'buffer')),
  DateNow: Date.now,
  FunctionPrototypeCall: uncurry(Function.prototype.call),
  MathAbs: Math.abs,
  MathMax: Math.max,
  MathMin: Math.min,
  MathPow: Math.pow,
  MathSign: Math.sign,
  MathTrunc: Math.trunc,
  NumberIsNaN: Number.isNaN,
  NumberMAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
  NumberMIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
  ObjectAssign: Object.assign,
  ObjectDefineProperties: Object.defineProperties,
  ObjectDefineProperty: Object.defineProperty,
  ObjectPrototypeIsPrototypeOf: uncurry(Object.prototype.isPrototypeOf),
  ObjectSetPrototypeOf: Object.setPrototypeOf,
  PromisePrototypeThen: uncurry(Promise.prototype.then),
  PromiseReject: (reason: unknown) => apply(promiseReject, PromiseCtor, [reason]),
  PromiseWithResolvers: () => {
    let resolve: unknown;
    let reject: unknown;
    const promise = new PromiseCtor((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  },
  RegExpPrototypeExec: uncurry(RegExp.prototype.exec),
  RegExpPrototypeSymbolReplace: uncurry(RegExp.prototype[Symbol.replace]),
  SafeSet,
  String,
  StringPrototypeSplit: uncurry(String.prototype.split),
  StringPrototypeToLowerCase: uncurry(String.prototype.toLowerCase),
  StringPrototypeToWellFormed: toWellFormed,
  Symbol,
  SymbolIterator: Symbol.iterator,
  SymbolToStringTag: Symbol.toStringTag,
  TypeError,
  TypedArrayPrototypeGetBuffer: uncurry(getter(TypedArrayPrototype, 'buffer')),
  Uint8Array,
};

// --- internal/errors: Node's `makeNodeErrorWithCode` shape and the `E()` texts these files throw ---
const kIsNodeError = Symbol('kIsNodeError');
const defineProperty = Object.defineProperty;
type Message = (...args: never[]) => string;
type ErrorBase = new (message?: string) => Error;
const captureStackTrace = Error.captureStackTrace;
const indexOf = String.prototype.indexOf;

/** Node's stack header for its own errors (`TypeError [CODE]: message`, its prepareStackTrace);
 * the isolate formats `stack` when it is captured. */
function nodeStack(error: Error, key: string): void {
  const stack = (error as { stack?: unknown }).stack;
  if (typeof stack !== 'string') return;
  const frames = apply(indexOf, stack, ['\n    at ']) as number;
  defineProperty(error, 'stack', {
    value: `${error.name} [${key}]: ${error.message}${frames < 0 ? '' : apply(sliceString, stack, [frames])}`,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

/**
 * `makeNodeErrorWithCode(Base, key)`: a `%s` text (`formatted`) is passed to `super` (own keys
 * `stack, message, code`), a function's text defined after it (`stack, code, message`).
 */
function nodeError(Base: ErrorBase, key: string, message: Message, formatted: boolean) {
  class NodeError extends Base {
    code = key;
    constructor(...args: never[]) {
      if (formatted) super(apply(message, undefined, args));
      else super();
      if (!formatted)
        defineProperty(this, 'message', {
          value: apply(message, undefined, args),
          enumerable: false,
          writable: true,
          configurable: true,
        });
      nodeStack(this, key);
    }
    // Node: «a workaround for wpt tests that expect that the error constructor has a `name`
    // property of the base class». A class cannot name an accessor `constructor`.
    // biome-ignore lint/complexity/useLiteralKeys: see above
    override get ['constructor']() {
      return Base;
    }
    get [kIsNodeError]() {
      return true;
    }
    override toString(): string {
      return `${this.name} [${key}]: ${this.message}`;
    }
  }
  return NodeError;
}
/** Node's `makeNodeErrorForHideStackFrame`: what a `hideStackFrames` validator throws. */
function hideStackFramesError(Err: new (...args: never[]) => Error, Base: ErrorBase) {
  return class HideStackFramesError extends Err {
    // biome-ignore lint/complexity/useLiteralKeys: as `nodeError`
    override get ['constructor']() {
      return Base;
    }
  };
}
/**
 * `E(key, message, Base, ...otherClasses)`: `codes[key]`, `codes[key][Other.name]`, and with
 * `HideStackFramesError` among them `codes[key].HideStackFramesError`. `formatted`: a `%s` text.
 */
function E(
  key: string,
  message: Message,
  formatted: boolean,
  Base: ErrorBase,
  others: readonly ErrorBase[] = [],
  hidesFrames = false,
) {
  const ctor = nodeError(Base, key, message, formatted) as ReturnType<typeof nodeError> &
    Record<string, unknown>;
  for (const Other of others) ctor[Other.name] = nodeError(Other, key, message, formatted);
  if (hidesFrames) ctor.HideStackFramesError = hideStackFramesError(ctor, Base);
  return ctor;
}

/** `internal/errors` `formatList`. */
function formatList(list: readonly string[], type = 'and'): string {
  if (list.length < 3) return list.join(` ${type} `);
  return `${list.slice(0, -1).join(', ')}, ${type} ${list[list.length - 1]}`;
}
const kTypes = [
  'string',
  'function',
  'number',
  'object',
  'Function',
  'Object',
  'boolean',
  'bigint',
  'symbol',
];
const classRegExp = /^[A-Z][a-zA-Z0-9]*$/;

const codes = {
  ERR_BUFFER_TOO_LARGE: E(
    'ERR_BUFFER_TOO_LARGE',
    (max: number) => `Cannot create a Buffer larger than ${max} bytes`,
    true,
    RangeError,
  ),
  ERR_INVALID_ARG_TYPE: E(
    'ERR_INVALID_ARG_TYPE',
    (name: string, expected: string | string[], actual: unknown) => {
      let msg = 'The ';
      if (name.endsWith(' argument')) msg += `${name} `;
      else msg += `"${name}" ${name.includes('.') ? 'property' : 'argument'} `;
      msg += 'must be ';
      const types: string[] = [];
      const instances: string[] = [];
      const other: string[] = [];
      for (const value of Array.isArray(expected) ? expected : [expected]) {
        if (kTypes.includes(value)) types.push(value.toLowerCase());
        else if (classRegExp.test(value)) instances.push(value);
        else other.push(value);
      }
      if (instances.length > 0) {
        const pos = types.indexOf('object');
        if (pos !== -1) {
          types.splice(pos, 1);
          instances.push('Object');
        }
      }
      if (types.length > 0) {
        msg += `${types.length > 1 ? 'one of type' : 'of type'} ${formatList(types, 'or')}`;
        if (instances.length > 0 || other.length > 0) msg += ' or ';
      }
      if (instances.length > 0) {
        msg += `an instance of ${formatList(instances, 'or')}`;
        if (other.length > 0) msg += ' or ';
      }
      if (other.length > 0) {
        if (other.length > 1) msg += `one of ${formatList(other, 'or')}`;
        else {
          if ((other[0] as string).toLowerCase() !== other[0]) msg += 'an ';
          msg += `${other[0]}`;
        }
      }
      return `${msg}. ${describeReceived(actual)}`;
    },
    false,
    TypeError,
    [],
    true,
  ),
  ERR_INVALID_ARG_VALUE: E(
    'ERR_INVALID_ARG_VALUE',
    (name: string, value: unknown, reason = 'is invalid') => {
      let inspected = inspect(value);
      if (inspected.length > 128) inspected = `${inspected.slice(0, 128)}...`;
      const type = name.includes('.') ? 'property' : 'argument';
      return `The ${type} '${name}' ${reason}. Received ${inspected}`;
    },
    false,
    TypeError,
    [RangeError],
    true,
  ),
  ERR_INVALID_STATE: E(
    'ERR_INVALID_STATE',
    (what: string) => `Invalid state: ${what}`,
    true,
    Error,
    [TypeError, RangeError],
  ),
  ERR_INVALID_THIS: E(
    'ERR_INVALID_THIS',
    (type: string) => `Value of "this" must be of type ${type}`,
    true,
    TypeError,
    [],
    true,
  ),
  ERR_MISSING_ARGS: E(
    'ERR_MISSING_ARGS',
    (...args: (string | string[])[]) => {
      const wrap = (a: string) => `"${a}"`;
      const names = args.map((a) => (Array.isArray(a) ? a.map(wrap).join(' or ') : wrap(a)));
      return `The ${formatList(names)} argument${args.length > 1 ? 's' : ''} must be specified`;
    },
    false,
    TypeError,
  ),
};

// --- internal/util/types: V8 brand checks through captured getters, no guest lookup ---
const abByteLength = getter(ArrayBuffer.prototype, 'byteLength');
const SharedArrayBufferCtor = globalThis.SharedArrayBuffer as
  | SharedArrayBufferConstructor
  | undefined;
const sabByteLength =
  SharedArrayBufferCtor && getter(SharedArrayBufferCtor.prototype, 'byteLength');
const typedArrayTag = getter(TypedArrayPrototype, Symbol.toStringTag);
const branded = (get: Fn | undefined, value: unknown): boolean => {
  if (get === undefined) return false;
  try {
    apply(get, value, []);
    return true;
  } catch {
    return false;
  }
};
const isArrayBuffer = (value: unknown): boolean => branded(abByteLength, value);
const types = {
  isArrayBuffer,
  isAnyArrayBuffer: (value: unknown): boolean =>
    isArrayBuffer(value) || branded(sabByteLength, value),
  isArrayBufferView: ArrayBuffer.isView,
  isTypedArray: (value: unknown): boolean => apply(typedArrayTag, value, []) !== undefined,
};

const freeze = Object.freeze;
const kEmptyObject = freeze({ __proto__: null });
const readableStreamGap = (): never => {
  throw notImplemented(
    'isolate-host.ReadableStream',
    'not available in the rifty isolate host, ADR-0557',
  );
};
/** Node's `hideStackFrames` validator: its error's frames start at the caller. */
function validateDictionary(value: unknown, name: string): void {
  if (value != null && typeof value !== 'object' && typeof value !== 'function') {
    const Err = codes.ERR_INVALID_ARG_TYPE.HideStackFramesError as new (
      ...args: unknown[]
    ) => Error;
    const error = new Err(name, 'a dictionary', value);
    captureStackTrace(error, validateDictionary);
    nodeStack(error, 'ERR_INVALID_ARG_TYPE');
    throw error;
  }
}

const BOUND: Readonly<Record<string, unknown>> = {
  'internal/constants': { EOL: '\n' },
  'internal/encoding': { TextDecoder, TextEncoder },
  'internal/errors': { codes },
  'internal/process/task_queues': { queueMicrotask },
  // `blob.js` reads `URL` only in `resolveObjectURL`, which the guest does not export: the ceiling.
  // Named by its key: a `function URL` declaration is renamed by the bundler (ADR-0571).
  'internal/url': {
    URL: (): never => {
      throw notImplemented('isolate-host.URL', 'not available in the rifty isolate host, ADR-0557');
    },
  },
  'internal/util': {
    customInspectSymbol: Symbol.for('nodejs.util.inspect.custom'),
    kEmptyObject,
    kEnumerableProperty: freeze({ __proto__: null, enumerable: true }),
    lazyDOMException: (message: string, name: string) => new DOMException(message, name),
  },
  'internal/util/inspect': { inspect },
  'internal/util/types': types,
  'internal/validators': {
    validateDictionary,
  },
  // `stream()`: web streams are outside the isolate guest (goal isolate-guest-web-api, M2).
  'internal/webstreams/readablestream': {
    get ReadableStream() {
      return readableStreamGap();
    },
  },
  'internal/worker/js_transferable': {
    // Transfer marks serve `structuredClone`/`postMessage`, ceilings here.
    markTransferMode(): void {},
    kClone: Symbol('messaging_clone_symbol'),
    kDeserialize: Symbol('messaging_deserialize_symbol'),
  },
  timers: { setImmediate },
};
const BINDINGS: Readonly<Record<string, unknown>> = {
  blob: blobBinding,
  // Node's `kMaxLength` on 64-bit: V8's TypedArray maximum, 2^53 - 1.
  buffer: { kMaxLength: Number.MAX_SAFE_INTEGER },
};
function bound(table: Readonly<Record<string, unknown>>, id: string): unknown {
  if (!Object.hasOwn(table, id)) throw new Error(`node-blob: unbound ${id}`);
  return table[id];
}

/** Evaluates Node's three files once; the classes the guest installs as its globals. */
export function createBlobClasses(): { readonly Blob: unknown; readonly File: unknown } {
  return createNodeBlob(
    primordials,
    (id) => bound(BINDINGS, id),
    (id) => bound(BOUND, id),
  );
}
