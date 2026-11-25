/**
 * The isolate guest's `TextDecoder`/`TextEncoder` (ADR-0577): Node v24.16.0's
 * `lib/internal/encoding.js` + `encoding/single-byte.js` + `encoding/util.js`
 * (`node-encoding/generated/`) over the bindings below. Node's C++ halves:
 * `encoding_binding` → the guest's UTF-8 codec (`text-codec.ts`); `icu` →
 * @exodus/bytes for utf-16le/be and gb18030 (gbk is gb18030's decoder, as in
 * Node; loaded on first use), the five encodings Node decodes by ICU's own
 * tables a named gap at construction. Evaluated with the shim, before the
 * runtime: everything here is captured at load; `inspect` and the
 * `ERR_INVALID_ARG_TYPE` message are the runtime's, bound by the entry.
 */
import loadExodusTextDecoder from './exodus-bytes/generated/text-decoder.js';
import { notImplemented } from './loud.ts';
import createNodeEncoding from './node-encoding/generated/encoding.js';
import { decodeUtf8, encodeIntoUtf8, encodeUtf8 } from './text-codec.ts';

const apply = Reflect.apply;
const defineProperty = Reflect.defineProperty;
const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const getPrototypeOf = Reflect.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const freeze = Object.freeze;
const assign = Object.assign;
const isView = ArrayBuffer.isView;
const fromCharCode = String.fromCharCode;
const Uint8ArrayPrimordial = Uint8Array;
const Uint16ArrayPrimordial = Uint16Array;
const TypeErrorPrimordial = TypeError;
const RangeErrorPrimordial = RangeError;
const TypeErrorPrototype = TypeError.prototype;
const TypedArray = getPrototypeOf(Uint8Array) as unknown as {
  from: unknown;
  of: unknown;
  prototype: object;
};
type Fn = (...args: never[]) => unknown;
const uncurry =
  (fn: unknown) =>
  (self: unknown, ...args: unknown[]): unknown =>
    apply(fn as Fn, self, args);
const getter = (proto: object, key: PropertyKey): Fn =>
  getOwnPropertyDescriptor(proto, key)?.get as Fn;
const typedArrayTag = getter(TypedArray.prototype, Symbol.toStringTag);
const typedArrayLength = getter(TypedArray.prototype, 'length');
const typedArrayBuffer = getter(TypedArray.prototype, 'buffer');
const typedArrayByteOffset = getter(TypedArray.prototype, 'byteOffset');
const typedArrayByteLength = getter(TypedArray.prototype, 'byteLength');
const dataViewBuffer = getter(DataView.prototype, 'buffer');
const dataViewByteOffset = getter(DataView.prototype, 'byteOffset');
const dataViewByteLength = getter(DataView.prototype, 'byteLength');
const arrayBufferByteLength = getter(ArrayBuffer.prototype, 'byteLength');
/** Set by the shim once its policy allows the global: a disabled guest never reads it. */
let sharedByteLength: Fn | undefined;
export function bindSharedArrayBuffer(ctor: typeof SharedArrayBuffer): void {
  sharedByteLength = getter(ctor.prototype, 'byteLength');
}
const arrayIterator = Array.prototype[Symbol.iterator];
const arrayIteratorNext = (getPrototypeOf([][Symbol.iterator]()) as Iterator<unknown>).next;

/** Node's `makeSafe`: the class carries the base's prototype members as they were at load. */
function makeSafe<T extends abstract new (...args: never[]) => unknown>(base: Fn, safe: T): T {
  const from = (base as unknown as { prototype: object }).prototype;
  for (const key of ownKeys(from))
    if (getOwnPropertyDescriptor(safe.prototype as object, key) === undefined)
      defineProperty(safe.prototype as object, key, getOwnPropertyDescriptor(from, key) as object);
  freeze(safe.prototype);
  return freeze(safe);
}
const SafeMap = makeSafe(Map as unknown as Fn, class SafeMap<K, V> extends Map<K, V> {});
const SafeSet = makeSafe(Set as unknown as Fn, class SafeSet<V> extends Set<V> {});
class SafeArrayIterator {
  readonly #it: unknown;
  constructor(array: unknown) {
    this.#it = apply(arrayIterator, array, []);
  }
  next(): unknown {
    return apply(arrayIteratorNext, this.#it, []);
  }
  [Symbol.iterator](): this {
    return this;
  }
}

const primordials = freeze({
  __proto__: null,
  Array,
  ArrayPrototypeFill: uncurry(Array.prototype.fill),
  Boolean,
  ObjectDefineProperties: Object.defineProperties,
  ObjectGetOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
  ObjectKeys: Object.keys,
  ObjectPrototypeHasOwnProperty: uncurry(Object.prototype.hasOwnProperty),
  ObjectSetPrototypeOf: Object.setPrototypeOf,
  ObjectValues: Object.values,
  SafeArrayIterator,
  SafeMap,
  SafeSet,
  StringPrototypeIncludes: uncurry(String.prototype.includes),
  StringPrototypeSlice: uncurry(String.prototype.slice),
  Symbol,
  SymbolToStringTag: Symbol.toStringTag,
  TypedArrayFrom: (ctor: unknown, ...args: unknown[]) => apply(TypedArray.from as Fn, ctor, args),
  TypedArrayOf: (ctor: unknown, ...args: unknown[]) => apply(TypedArray.of as Fn, ctor, args),
  TypedArrayPrototypeIncludes: uncurry((TypedArray.prototype as Uint8Array).includes),
  TypedArrayPrototypeSet: uncurry((TypedArray.prototype as Uint8Array).set),
  Uint16Array,
  Uint8Array,
});

// --- the runtime's, bound by the entry once it has loaded (every use is at call time) ---
interface EncodingRuntime {
  readonly inspect: (value: unknown, options?: object) => string;
  /** Node's `ERR_INVALID_ARG_TYPE` message. */
  readonly invalidArgTypeMessage: (
    name: string,
    expected: string | string[],
    actual: unknown,
  ) => string;
}
let runtime: EncodingRuntime | null = null;
export function bindEncodingRuntime(bound: EncodingRuntime): void {
  runtime = bound;
}
function bound(): EncodingRuntime {
  if (runtime === null)
    throw new Error('isolate-host guest: TextDecoder error before runtime load');
  return runtime;
}

// --- internal/errors: Node's `makeNodeErrorWithCode` shapes (own `code`; `constructor` → base) ---
type Message = (self: Error, a: unknown, b: unknown, c: unknown) => string;
/** Node's fixed-message case (`%s` → the one string argument), before guest code splits it. */
function nodeError(Base: ErrorConstructor, key: string, message: string) {
  const [pre, post] = message.split('%s') as [string, string];
  return class NodeError extends Base {
    code = key;
    constructor(arg: unknown) {
      super(`${pre}${arg}${post}`);
    }
    // biome-ignore lint/complexity/useLiteralKeys: a class cannot name an accessor `constructor` otherwise.
    override get ['constructor']() {
      return Base;
    }
    override toString(): string {
      return `${this.name} [${key}]: ${this.message}`;
    }
  };
}
/** Node's function-message case: `super()`, `code`, then the message (it may set fields). */
function nodeErrorFn(Base: ErrorConstructor, key: string, message: Message) {
  return class NodeError extends Base {
    code = key;
    constructor(a?: unknown, b?: unknown, c?: unknown) {
      super();
      defineProperty(this, 'message', {
        value: message(this, a, b, c),
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    // biome-ignore lint/complexity/useLiteralKeys: see nodeError
    override get ['constructor']() {
      return Base;
    }
    override toString(): string {
      return `${this.name} [${key}]: ${this.message}`;
    }
  };
}
const codes = {
  ERR_ENCODING_NOT_SUPPORTED: nodeError(
    RangeErrorPrimordial,
    'ERR_ENCODING_NOT_SUPPORTED',
    'The "%s" encoding is not supported',
  ),
  ERR_ENCODING_INVALID_ENCODED_DATA: nodeErrorFn(
    TypeErrorPrimordial,
    'ERR_ENCODING_INVALID_ENCODED_DATA',
    (self, encoding, ret) => {
      (self as Error & { errno: unknown }).errno = ret;
      return `The encoded data was not valid for encoding ${encoding}`;
    },
  ),
  ERR_INVALID_ARG_TYPE: nodeErrorFn(
    TypeErrorPrimordial,
    'ERR_INVALID_ARG_TYPE',
    (_, name, expected, actual) =>
      bound().invalidArgTypeMessage(name as string, expected as string | string[], actual),
  ),
  ERR_INVALID_THIS: nodeError(
    TypeErrorPrimordial,
    'ERR_INVALID_THIS',
    'Value of "this" must be of type %s',
  ),
  ERR_NO_ICU: nodeError(
    TypeErrorPrimordial,
    'ERR_NO_ICU',
    '%s is not supported on Node.js compiled without ICU',
  ),
};
/** A C++ binding's throw: a plain error with an own `code`. */
const cxxError = (message: string, code: string): TypeError =>
  assign(new TypeErrorPrimordial(message), { code });

// --- internal/util/types, validators, util ---
function isAnyArrayBuffer(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || isView(value)) return false;
  try {
    apply(arrayBufferByteLength, value, []);
    return true;
  } catch {}
  if (sharedByteLength === undefined) return false;
  try {
    apply(sharedByteLength, value, []);
    return true;
  } catch {
    return false;
  }
}
const isUint8Array = (value: unknown): boolean => apply(typedArrayTag, value, []) === 'Uint8Array';
const kValidateObjectAllowNullable = 1;
const kValidateObjectAllowArray = 2;
const kValidateObjectAllowFunction = 4;
const isArray = Array.isArray;
const validators = {
  validateString(value: unknown, name: string): void {
    if (typeof value !== 'string') throw new codes.ERR_INVALID_ARG_TYPE(name, 'string', value);
  },
  validateObject(value: unknown, name: string, options = 0): void {
    if (
      (!(options & kValidateObjectAllowNullable) && value === null) ||
      (!(options & kValidateObjectAllowArray) && isArray(value)) ||
      (typeof value !== 'object' &&
        (!(options & kValidateObjectAllowFunction) || typeof value !== 'function'))
    )
      throw new codes.ERR_INVALID_ARG_TYPE(name, 'Object', value);
  },
  kValidateObjectAllowObjectsAndNull:
    kValidateObjectAllowNullable | kValidateObjectAllowArray | kValidateObjectAllowFunction,
};
function getConstructorOf(start: unknown): unknown {
  for (let obj = start; obj; obj = getPrototypeOf(obj as object)) {
    const d = getOwnPropertyDescriptor(obj as object, 'constructor');
    if (d !== undefined && typeof d.value === 'function' && d.value.name !== '') return d.value;
  }
  return null;
}
const kEnumerableProperty = freeze({ __proto__: null, enumerable: true });

// --- internal/buffer FastBuffer: the Buffer members `encoding.js`/`single-byte.js` call ---
const CHUNK = 0x8000;
/** `count` units (`wide`: 16-bit LE) of `buffer` from byte `at`, as a string. */
function charsOf(buffer: ArrayBuffer, at: number, count: number, wide: boolean): string {
  let out = '';
  for (let i = 0; i < count; i += CHUNK) {
    const n = count - i < CHUNK ? count - i : CHUNK;
    const view = wide
      ? new Uint16ArrayPrimordial(buffer, at + i * 2, n)
      : new Uint8ArrayPrimordial(buffer, at + i, n);
    out += apply(fromCharCode, null, view as unknown as number[]);
  }
  return out;
}
const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  apply(typedArrayBuffer, bytes, []) as ArrayBuffer;
const offsetOf = (bytes: Uint8Array): number => apply(typedArrayByteOffset, bytes, []) as number;
const lengthOf = (bytes: Uint8Array): number => apply(typedArrayLength, bytes, []) as number;
class FastBuffer extends Uint8ArrayPrimordial {
  latin1Slice(): string {
    return charsOf(bufferOf(this), offsetOf(this), lengthOf(this), false);
  }
  /** Little-endian code units (the guest's platform); `single-byte.js` passes a fresh, aligned view. */
  ucs2Slice(): string {
    return charsOf(bufferOf(this), offsetOf(this), lengthOf(this) >> 1, true);
  }
  swap16(): this {
    for (let i = 0; i + 1 < lengthOf(this); i += 2) {
      const t = this[i] as number;
      this[i] = this[i + 1] as number;
      this[i + 1] = t;
    }
    return this;
  }
}
function isAscii(bytes: Uint8Array): boolean {
  const n = lengthOf(bytes);
  for (let i = 0; i < n; i++) if ((bytes[i] as number) > 0x7f) return false;
  return true;
}

/** A binding's input as bytes, or Node's C++ refusal (`name`: `list` utf-8, `input` ICU). */
function bytesOf(input: unknown, name: string): Uint8Array {
  if (isView(input)) {
    const tag = apply(typedArrayTag, input, []);
    if (tag === 'Uint8Array') return input as Uint8Array;
    return tag === undefined
      ? new Uint8ArrayPrimordial(
          apply(dataViewBuffer, input, []) as ArrayBuffer,
          apply(dataViewByteOffset, input, []) as number,
          apply(dataViewByteLength, input, []) as number,
        )
      : new Uint8ArrayPrimordial(
          apply(typedArrayBuffer, input, []) as ArrayBuffer,
          apply(typedArrayByteOffset, input, []) as number,
          apply(typedArrayByteLength, input, []) as number,
        );
  }
  if (isAnyArrayBuffer(input)) return new Uint8ArrayPrimordial(input as ArrayBuffer);
  throw cxxError(
    `The "${name}" argument must be an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView.`,
    'ERR_INVALID_ARG_TYPE',
  );
}

// --- internalBinding('encoding_binding'): utf-8 in the guest codec ---
const encodeIntoResults = new Uint32Array(2);
const encodingBinding = {
  encodeIntoResults,
  encodeUtf8String: encodeUtf8,
  encodeInto(src: string, dest: Uint8Array): void {
    const { read, written } = encodeIntoUtf8(src, dest);
    encodeIntoResults[0] = read;
    encodeIntoResults[1] = written;
  },
  decodeUTF8(input: unknown, ignoreBOM: unknown, fatal: unknown): string {
    return decodeUtf8(bytesOf(input, 'list'), !!fatal, !!ignoreBOM);
  },
};

// --- internalBinding('icu'): what Node's ICU converters decode here ---
const CONVERTER_FLAGS_FLUSH = 0x1;
const CONVERTER_FLAGS_FATAL = 0x2;
const CONVERTER_FLAGS_IGNORE_BOM = 0x4;
/** Node decodes these by ICU's own tables, which differ from WHATWG's: the named gap. */
const ICU_ONLY = new Set(['big5', 'euc-jp', 'iso-2022-jp', 'shift_jis', 'euc-kr']);
const hasIcuOnly = uncurry(Set.prototype.has);
const ICU_ONLY_HINT =
  'decoded by ICU in Node; no source equals it in the rifty isolate host, ADR-0577';
type Decoder = { decode(input: Uint8Array, options: { stream: boolean }): string };
let ExodusTextDecoder: ReturnType<typeof loadExodusTextDecoder> | undefined;
const icuBinding = {
  getConverter(encoding: string, flags: number): Decoder | undefined {
    if (hasIcuOnly(ICU_ONLY, encoding))
      throw notImplemented(`isolate-host.TextDecoder(${encoding})`, ICU_ONLY_HINT);
    if (encoding !== 'utf-16le' && encoding !== 'utf-16be' && encoding !== 'gb18030') return;
    ExodusTextDecoder ??= loadExodusTextDecoder();
    const Decoder = ExodusTextDecoder;
    return new Decoder(encoding, {
      fatal: (flags & CONVERTER_FLAGS_FATAL) !== 0,
      ignoreBOM: (flags & CONVERTER_FLAGS_IGNORE_BOM) !== 0,
    });
  },
  decode(handle: Decoder, input: unknown, flags: number, encoding: string): string {
    const bytes = bytesOf(input, 'input');
    try {
      return handle.decode(bytes, { stream: (flags & CONVERTER_FLAGS_FLUSH) === 0 });
    } catch (error) {
      // @exodus/bytes refuses invalid data under `fatal` with a plain `TypeError`.
      if (
        typeof error === 'object' &&
        error !== null &&
        getPrototypeOf(error) === TypeErrorPrototype
      )
        throw cxxError(
          `The encoded data was not valid for encoding ${encoding}`,
          'ERR_ENCODING_INVALID_ENCODED_DATA',
        );
      throw error;
    }
  },
};

const BINDINGS: Record<string, unknown> = {
  __proto__: null,
  config: { hasIntl: true },
  encoding_binding: encodingBinding,
  icu: icuBinding,
};
const MODULES: Record<string, unknown> = {
  __proto__: null,
  buffer: { isAscii },
  'internal/buffer': { FastBuffer },
  'internal/errors': { codes },
  'internal/util': {
    getConstructorOf,
    customInspectSymbol: Symbol.for('nodejs.util.inspect.custom'),
    kEmptyObject: freeze({ __proto__: null }),
    kEnumerableProperty,
  },
  'internal/util/inspect': {
    inspect: (value: unknown, options?: object) => bound().inspect(value, options),
  },
  'internal/util/types': { isAnyArrayBuffer, isArrayBufferView: isView, isUint8Array },
  'internal/validators': validators,
};
const lookup = (table: Record<string, unknown>, id: string): unknown => {
  // `string_decoder` is Node's path without ICU (`hasIntl` is true here): never loaded.
  if (!(id in table)) throw new Error(`isolate-host guest: node-encoding needs ${id}`);
  return table[id];
};

export const { TextDecoder, TextEncoder } = createNodeEncoding(
  primordials,
  (id) => lookup(BINDINGS, id),
  (id) => lookup(MODULES, id),
);
