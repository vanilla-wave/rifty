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
// ES2024 members the isolate's V8 has (Node v24's); the build's type lib is ES2022.
const promiseWithResolvers = (Promise as unknown as { withResolvers: Fn }).withResolvers;
const primordials = {
  ArrayBufferIsView: ArrayBuffer.isView,
  ArrayBufferPrototypeGetByteLength: uncurry(getter(ArrayBuffer.prototype, 'byteLength')),
  ArrayPrototypePush: uncurry(Array.prototype.push),
  ArrayPrototypeToSorted: uncurry(Array.prototype.toSorted),
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
  PromiseWithResolvers: () => apply(promiseWithResolvers, PromiseCtor, []),
  RegExpPrototypeExec: uncurry(RegExp.prototype.exec),
  RegExpPrototypeSymbolReplace: uncurry(RegExp.prototype[Symbol.replace]),
  SafeSet,
  String,
  StringPrototypeSplit: uncurry(String.prototype.split),
  StringPrototypeToLowerCase: uncurry(String.prototype.toLowerCase),
  StringPrototypeToWellFormed: uncurry(
    (String.prototype as unknown as { toWellFormed: Fn }).toWellFormed,
  ),
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

function nodeError(Base: ErrorBase, key: string, message: Message) {
  class NodeError extends Base {
    code = key;
    constructor(...args: never[]) {
      super();
      defineProperty(this, 'message', {
        value: apply(message, undefined, args),
        enumerable: false,
        writable: true,
        configurable: true,
      });
      // Node's own stack header (`TypeError [CODE]: message`, its prepareStackTrace for a Node
      // error); the isolate formats `stack` at `super()`, before the message exists.
      const stack = (this as { stack?: unknown }).stack;
      if (typeof stack === 'string' && stack.startsWith(this.name))
        defineProperty(this, 'stack', {
          value: `${this.name} [${key}]: ${this.message}${stack.slice(this.name.length)}`,
          enumerable: false,
          writable: true,
          configurable: true,
        });
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
/** `E(key, message, Base, ...otherClasses)`: `codes[key]` plus `codes[key][Other.name]`. */
function E(key: string, message: Message, Base: ErrorBase, ...others: ErrorBase[]) {
  const ctor = nodeError(Base, key, message) as ReturnType<typeof nodeError> &
    Record<string, unknown>;
  for (const Other of others) ctor[Other.name] = nodeError(Other, key, message);
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
    TypeError,
  ),
  ERR_INVALID_ARG_VALUE: E(
    'ERR_INVALID_ARG_VALUE',
    (name: string, value: unknown, reason = 'is invalid') => {
      let inspected = inspect(value);
      if (inspected.length > 128) inspected = `${inspected.slice(0, 128)}...`;
      const type = name.includes('.') ? 'property' : 'argument';
      return `The ${type} '${name}' ${reason}. Received ${inspected}`;
    },
    TypeError,
    RangeError,
  ),
  ERR_INVALID_STATE: E(
    'ERR_INVALID_STATE',
    (what: string) => `Invalid state: ${what}`,
    Error,
    TypeError,
    RangeError,
  ),
  ERR_INVALID_THIS: E(
    'ERR_INVALID_THIS',
    (type: string) => `Value of "this" must be of type ${type}`,
    TypeError,
  ),
  ERR_MISSING_ARGS: E(
    'ERR_MISSING_ARGS',
    (...args: (string | string[])[]) => {
      const wrap = (a: string) => `"${a}"`;
      const names = args.map((a) => (Array.isArray(a) ? a.map(wrap).join(' or ') : wrap(a)));
      return `The ${formatList(names)} argument${args.length > 1 ? 's' : ''} must be specified`;
    },
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
// `blob.js` reads `URL` only in `resolveObjectURL`, which the guest does not export: the ceiling.
const urlGap = function URL(): never {
  throw notImplemented('isolate-host.URL', 'not available in the rifty isolate host, ADR-0557');
};

const BOUND: Readonly<Record<string, unknown>> = {
  'internal/constants': { EOL: '\n' },
  'internal/encoding': { TextDecoder, TextEncoder },
  'internal/errors': { codes },
  'internal/process/task_queues': { queueMicrotask },
  'internal/url': { URL: urlGap },
  'internal/util': {
    customInspectSymbol: Symbol.for('nodejs.util.inspect.custom'),
    kEmptyObject,
    kEnumerableProperty: freeze({ __proto__: null, enumerable: true }),
    lazyDOMException: (message: string, name: string) => new DOMException(message, name),
  },
  'internal/util/inspect': { inspect },
  'internal/util/types': types,
  'internal/validators': {
    validateDictionary(value: unknown, name: string): void {
      if (value != null && typeof value !== 'object' && typeof value !== 'function')
        throw new codes.ERR_INVALID_ARG_TYPE(
          name as never,
          'a dictionary' as never,
          value as never,
        );
    },
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
