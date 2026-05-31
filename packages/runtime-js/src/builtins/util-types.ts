/**
 * Node-compatible `node:util/types` — the runtime type-reflection predicates.
 *
 * Real Node implements these against V8-internal type tags that user code
 * cannot forge. In a pure-JS realm we have no such oracle, so we approximate
 * faithfully:
 *
 * - Types with a public, spoof-resistant brand (the TypedArrays, `Map`, `Set`,
 *   `Date`, `RegExp`, `Promise`, `ArrayBuffer`, `SharedArrayBuffer`,
 *   `DataView`, `WeakMap`, `WeakSet`, `WeakRef`) are detected by `instanceof`
 *   plus, where it matters, the V8 `Object.prototype.toString` brand so that
 *   subclasses and cross-realm instances still match the way Node's do.
 * - Internal objects with no public constructor (Map/Set/Array/String
 *   iterators, `arguments`, generator objects, the boxed primitives) are
 *   detected by their V8 `[[Class]]` brand via `Object.prototype.toString`,
 *   which is exactly the tag V8 stamps on those instances.
 *
 * This matches Node's output for every genuine instance a dependency produces
 * (the only thing that can diverge is a hand-forged `Symbol.toStringTag`, which
 * no real value carries). See the `cases/util/types.case.ts` parity case for
 * the head-to-head against real Node v24.
 */

const objToString = Object.prototype.toString;
/** The V8 `[[Class]]` brand, e.g. `"Map Iterator"`, `"Arguments"`, `"Number"`. */
function brand(value: unknown): string {
  return objToString.call(value).slice(8, -1);
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

// --- ArrayBuffer family ----------------------------------------------------

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return brand(value) === 'ArrayBuffer';
}

export function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return brand(value) === 'SharedArrayBuffer';
}

export function isAnyArrayBuffer(value: unknown): value is ArrayBuffer | SharedArrayBuffer {
  const b = brand(value);
  return b === 'ArrayBuffer' || b === 'SharedArrayBuffer';
}

export function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

export function isDataView(value: unknown): value is DataView {
  return brand(value) === 'DataView';
}

// --- TypedArrays -----------------------------------------------------------

export function isTypedArray(
  value: unknown,
): value is
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function isBrand<T>(name: string) {
  return (value: unknown): value is T => brand(value) === name;
}

export const isInt8Array = isBrand<Int8Array>('Int8Array');
export const isUint8Array = isBrand<Uint8Array>('Uint8Array');
export const isUint8ClampedArray = isBrand<Uint8ClampedArray>('Uint8ClampedArray');
export const isInt16Array = isBrand<Int16Array>('Int16Array');
export const isUint16Array = isBrand<Uint16Array>('Uint16Array');
export const isInt32Array = isBrand<Int32Array>('Int32Array');
export const isUint32Array = isBrand<Uint32Array>('Uint32Array');
export const isFloat32Array = isBrand<Float32Array>('Float32Array');
export const isFloat64Array = isBrand<Float64Array>('Float64Array');
export const isBigInt64Array = isBrand<BigInt64Array>('BigInt64Array');
export const isBigUint64Array = isBrand<BigUint64Array>('BigUint64Array');

// --- Keyed / weak collections ---------------------------------------------

export const isMap = isBrand<Map<unknown, unknown>>('Map');
export const isSet = isBrand<Set<unknown>>('Set');
export const isWeakMap = isBrand<WeakMap<object, unknown>>('WeakMap');
export const isWeakSet = isBrand<WeakSet<object>>('WeakSet');
export const isMapIterator = isBrand<IterableIterator<unknown>>('Map Iterator');
export const isSetIterator = isBrand<IterableIterator<unknown>>('Set Iterator');

// --- Core JS objects -------------------------------------------------------

export const isDate = isBrand<Date>('Date');
export const isRegExp = isBrand<RegExp>('RegExp');
export const isPromise = isBrand<Promise<unknown>>('Promise');

export function isNativeError(value: unknown): value is Error {
  // Node's predicate is true for any of the V8 native error constructors
  // (Error, TypeError, RangeError, …) and false for plain objects that merely
  // look error-ish. `instanceof Error` is the spoof-resistant brand check that
  // matches that set; a forged `[object Error]` tag would not be a real error.
  return value instanceof Error;
}

export function isArgumentsObject(value: unknown): boolean {
  return brand(value) === 'Arguments';
}

export function isGeneratorObject(value: unknown): boolean {
  const b = brand(value);
  return b === 'Generator' || b === 'AsyncGenerator';
}

// --- Functions -------------------------------------------------------------

export function isAsyncFunction(value: unknown): boolean {
  return typeof value === 'function' && brand(value) === 'AsyncFunction';
}

export function isGeneratorFunction(value: unknown): boolean {
  return typeof value === 'function' && brand(value) === 'GeneratorFunction';
}

// --- Boxed primitives ------------------------------------------------------

export const isNumberObject = (value: unknown): boolean =>
  isObjectLike(value) && brand(value) === 'Number';
export const isStringObject = (value: unknown): boolean =>
  isObjectLike(value) && brand(value) === 'String';
export const isBooleanObject = (value: unknown): boolean =>
  isObjectLike(value) && brand(value) === 'Boolean';
export const isSymbolObject = (value: unknown): boolean =>
  isObjectLike(value) && brand(value) === 'Symbol';
export const isBigIntObject = (value: unknown): boolean =>
  isObjectLike(value) && brand(value) === 'BigInt';

export function isBoxedPrimitive(value: unknown): boolean {
  return (
    isNumberObject(value) ||
    isStringObject(value) ||
    isBooleanObject(value) ||
    isSymbolObject(value) ||
    isBigIntObject(value)
  );
}

// --- Misc V8-internal --------------------------------------------------------

export const isWeakRef = isBrand<WeakRef<object>>('WeakRef');

export function isProxy(_value: unknown): boolean {
  // A Proxy is transparent to user-level reflection; there is no spoof-free way
  // to detect one in-realm. Node's predicate relies on a V8 internal that has
  // no JS surface, so this is a genuine in-realm ceiling. Returning false would
  // be a silent wrong answer, so we throw rather than lie.
  throw new Error(
    'util.types.isProxy is not detectable in a pure-JS realm (no V8 internal); see compat-matrix',
  );
}

/**
 * The `node:util/types` module exports — also re-exported as `util.types`.
 */
export const types = {
  isArrayBuffer,
  isSharedArrayBuffer,
  isAnyArrayBuffer,
  isArrayBufferView,
  isDataView,
  isTypedArray,
  isInt8Array,
  isUint8Array,
  isUint8ClampedArray,
  isInt16Array,
  isUint16Array,
  isInt32Array,
  isUint32Array,
  isFloat32Array,
  isFloat64Array,
  isBigInt64Array,
  isBigUint64Array,
  isMap,
  isSet,
  isWeakMap,
  isWeakSet,
  isMapIterator,
  isSetIterator,
  isDate,
  isRegExp,
  isPromise,
  isNativeError,
  isArgumentsObject,
  isGeneratorObject,
  isAsyncFunction,
  isGeneratorFunction,
  isNumberObject,
  isStringObject,
  isBooleanObject,
  isSymbolObject,
  isBigIntObject,
  isBoxedPrimitive,
  isWeakRef,
  isProxy,
};

export default types;
