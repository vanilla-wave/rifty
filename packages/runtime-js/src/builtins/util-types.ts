/**
 * Node-compatible `node:util/types` runtime type-reflection predicates.
 *
 * Node detects these via V8-internal type tags that user code cannot forge.
 * A pure-JS realm has no such oracle, so we approximate via the V8 `[[Class]]`
 * brand (`Object.prototype.toString`) — the same tag V8 stamps on instances,
 * including internal objects with no public constructor (iterators,
 * `arguments`, generators, boxed primitives). This matches Node for every
 * genuine instance; the only divergence is a hand-forged `Symbol.toStringTag`,
 * which no real value carries. Parity case: `cases/util/types.case.ts` (Node v24).
 */

const objToString = Object.prototype.toString;
/** V8 `[[Class]]` brand, e.g. `"Map Iterator"`, `"Arguments"`, `"Number"`. */
function brand(value: unknown): string {
  return objToString.call(value).slice(8, -1);
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

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

export const isMap = isBrand<Map<unknown, unknown>>('Map');
export const isSet = isBrand<Set<unknown>>('Set');
export const isWeakMap = isBrand<WeakMap<object, unknown>>('WeakMap');
export const isWeakSet = isBrand<WeakSet<object>>('WeakSet');
export const isMapIterator = isBrand<IterableIterator<unknown>>('Map Iterator');
export const isSetIterator = isBrand<IterableIterator<unknown>>('Set Iterator');

export const isDate = isBrand<Date>('Date');
export const isRegExp = isBrand<RegExp>('RegExp');
export const isPromise = isBrand<Promise<unknown>>('Promise');

export function isNativeError(value: unknown): value is Error {
  // True for any V8 native error constructor (Error, TypeError, …), false for
  // error-ish plain objects. `instanceof Error` is the spoof-resistant check;
  // a forged `[object Error]` tag would not be a real error.
  return value instanceof Error;
}

export function isArgumentsObject(value: unknown): boolean {
  return brand(value) === 'Arguments';
}

export function isGeneratorObject(value: unknown): boolean {
  const b = brand(value);
  return b === 'Generator' || b === 'AsyncGenerator';
}

export function isAsyncFunction(value: unknown): boolean {
  return typeof value === 'function' && brand(value) === 'AsyncFunction';
}

export function isGeneratorFunction(value: unknown): boolean {
  return typeof value === 'function' && brand(value) === 'GeneratorFunction';
}

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

export const isWeakRef = isBrand<WeakRef<object>>('WeakRef');

export function isProxy(_value: unknown): boolean {
  // A Proxy is transparent to user-level reflection; Node relies on a V8
  // internal with no JS surface, so it is undetectable in-realm. Returning
  // false would be a silent wrong answer, so we throw rather than lie.
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
