import { setImmediate } from '@riftydev/runtime-js/builtins/timers';
/**
 * Inputs of Node v24.16.0's generated `internal/webidl`/`blob`/`file` (ADR-0578 §2–§4):
 * `primordials` captured at bundle load (before guest code), Node's error classes and the one
 * validator they throw through, the JS byte store, and the guest's own codec, inspect,
 * `DOMException`, microtask queue and immediates. Everything else is upstream's text.
 */
import { inspect } from '@riftydev/runtime-js/internal';
import { notImplemented } from '../loud.ts';
import { TextDecoder, TextEncoder } from '../node-encoding.ts';
import { codes, nodeStack } from '../node-errors.ts';
import {
  customInspectSymbol,
  jsTransferable,
  kEmptyObject,
  kEnumerableProperty,
} from '../node-internal.ts';
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

const captureStackTrace = Error.captureStackTrace;
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
    customInspectSymbol,
    kEmptyObject,
    kEnumerableProperty,
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
  'internal/worker/js_transferable': jsTransferable,
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

/** Evaluates Node's three files once: the classes the guest installs as its globals, and the
 * evaluated `internal/webidl` (node-event-target binds the same one). */
export function createBlobClasses(): ReturnType<typeof createNodeBlob> {
  return createNodeBlob(
    primordials,
    (id) => bound(BINDINGS, id),
    (id) => bound(BOUND, id),
  );
}
