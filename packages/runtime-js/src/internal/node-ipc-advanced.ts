import { Buffer, NotImplementedError } from '@riftydev/io';
import { snapshotSharedView } from './node-ipc-shared-view.ts';
import { cloneFailureMessage, proxyCloneFailure } from './proxy-provenance.ts';

const mapEntries = Map.prototype.entries;
const setValues = Set.prototype.values;
const dateTime = Date.prototype.getTime;
const regexpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')?.get as (
  this: never,
) => string;
const isError = (Error as ErrorConstructor & { isError(value: unknown): value is Error }).isError;
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')
  ?.get as (this: never) => number;
const boxedReaders = [
  Boolean.prototype.valueOf,
  Number.prototype.valueOf,
  String.prototype.valueOf,
  BigInt.prototype.valueOf,
  Symbol.prototype.valueOf,
];
const apply = Reflect.apply;
const promiseResolve = Promise.resolve;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const isExtensible = Object.isExtensible;
const nonPromise = {};
function PromiseBrandProbe(): never {
  throw nonPromise;
}

/** No reactions or guest callbacks: PromiseResolve returns the same Promise,
 * or constructs the private throwing probe before inspecting a plain object's then. */
function isPromise(value: object): boolean {
  const prior = ownDescriptor(value, 'constructor');
  if (
    (prior && !prior.configurable && (!('value' in prior) || !prior.writable)) ||
    (!prior && !isExtensible(value))
  ) {
    throw new NotImplementedError('child_process.serialization.advanced.opaque-brand');
  }
  defineProperty(
    value,
    'constructor',
    prior?.configurable === false
      ? { value: PromiseBrandProbe }
      : { value: PromiseBrandProbe, configurable: true, writable: true, enumerable: false },
  );
  try {
    try {
      return apply(promiseResolve, PromiseBrandProbe, [value]) === value;
    } catch (error) {
      if (error === nonPromise) return false;
      throw error;
    }
  } finally {
    if (prior) defineProperty(value, 'constructor', prior);
    else deleteProperty(value, 'constructor');
  }
}
const weakMapHas = WeakMap.prototype.has;
const weakSetHas = WeakSet.prototype.has;
const weakRefDeref = WeakRef.prototype.deref;
const unregister = FinalizationRegistry.prototype.unregister;
const sharedBufferLength =
  typeof SharedArrayBuffer === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')?.get;
// Never exposed or registered: probing a registry cannot remove a guest registration.
const brandToken = {};

function hasWeakSlot(value: object): boolean {
  for (const read of [weakMapHas, weakSetHas, weakRefDeref, unregister]) {
    try {
      apply(read, value, [brandToken]);
      return true;
    } catch {
      /* Wrong intrinsic receiver. */
    }
  }
  return false;
}

function slot<T>(value: object, read: (this: never) => T): T | undefined {
  try {
    return apply(read, value, []) as T;
  } catch {
    return undefined;
  }
}

interface AdvancedFrame {
  readonly value: unknown;
  readonly buffers: readonly Uint8Array[];
}

function nativeClone(value: object): object {
  try {
    return structuredClone(value) as object;
  } catch (error) {
    if (error instanceof Error && error.name === 'DataCloneError') {
      throw new Error(cloneFailureMessage(error));
    }
    throw error;
  }
}

function define(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Snapshot once before dispatch. Buffer provenance travels outside guest data. */
export function encodeAdvancedIpc(message: unknown): AdvancedFrame {
  const seen = new Map<object, object>();
  const buffers: Uint8Array[] = [];
  function copy(value: unknown): unknown {
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      const failure = proxyCloneFailure(value);
      if (failure !== undefined) throw new Error(failure);
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new Error(`${String(value)} could not be cloned.`);
    }
    if (typeof value !== 'object' || value === null) return value;
    const prior = seen.get(value);
    if (prior !== undefined) return prior;
    if (Buffer.isBuffer(value)) {
      const bytes = Uint8Array.from(value as Uint8Array);
      seen.set(value, bytes);
      buffers.push(bytes);
      return bytes;
    }
    const entries = slot(value, mapEntries);
    if (entries !== undefined) {
      const result = new Map<unknown, unknown>();
      seen.set(value, result);
      for (const [key, entry] of entries) result.set(copy(key), copy(entry));
      return result;
    }
    const values = slot(value, setValues);
    if (values !== undefined) {
      const result = new Set<unknown>();
      seen.set(value, result);
      for (const entry of values) result.add(copy(entry));
      return result;
    }
    if (isError(value)) {
      const constructors: Readonly<Record<string, ErrorConstructor>> = {
        Error,
        EvalError,
        RangeError,
        ReferenceError,
        SyntaxError,
        TypeError,
        URIError,
      };
      const name = value.name;
      const Constructor =
        (Object.hasOwn(constructors, name) ? constructors[name] : undefined) ?? Error;
      const message = Object.getOwnPropertyDescriptor(value, 'message');
      const result = new Constructor(
        message && 'value' in message ? `${message.value}` : undefined,
      );
      seen.set(value, result);
      result.stack = value.stack;
      const cause = Object.getOwnPropertyDescriptor(value, 'cause');
      if (cause && 'value' in cause) result.cause = copy(cause.value);
      return result;
    }
    if (sharedBufferLength !== undefined && slot(value, sharedBufferLength) !== undefined) {
      throw new Error('#<SharedArrayBuffer> could not be cloned.');
    }
    if (
      slot(value, dateTime) !== undefined ||
      slot(value, regexpSource) !== undefined ||
      slot(value, arrayBufferLength) !== undefined ||
      ArrayBuffer.isView(value) ||
      boxedReaders.some((read) => slot(value, read as (this: never) => unknown) !== undefined) ||
      hasWeakSlot(value)
    ) {
      const cloned = nativeClone(value);
      const result = ArrayBuffer.isView(cloned) ? snapshotSharedView(cloned) : cloned;
      seen.set(value, result);
      return result;
    }
    const array = Array.isArray(value);
    if (!array && isPromise(value)) return nativeClone(value);
    const result: object = array ? new Array(value.length) : {};
    seen.set(value, result);
    for (const key of Object.keys(value)) define(result, key, copy(Reflect.get(value, key)));
    return result;
  }
  return { value: copy(message), buffers };
}

/** Restore brands after MessagePort's clone, preserving shared/cyclic references. */
export function decodeAdvancedIpc(frame: unknown): unknown {
  if (
    typeof frame !== 'object' ||
    frame === null ||
    !('value' in frame) ||
    !('buffers' in frame) ||
    !Array.isArray(frame.buffers) ||
    !frame.buffers.every((value: unknown) => value instanceof Uint8Array)
  ) {
    throw new TypeError('invalid advanced IPC frame');
  }
  const seen = new Map<object, object>();
  for (const bytes of frame.buffers as Uint8Array[]) seen.set(bytes, Buffer.from(bytes));
  function restore(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) return value;
    const prior = seen.get(value);
    if (prior !== undefined) return prior;
    seen.set(value, value);
    if (value instanceof Map) {
      const entries = [...value];
      value.clear();
      for (const [key, entry] of entries) value.set(restore(key), restore(entry));
    } else if (value instanceof Set) {
      const entries = [...value];
      value.clear();
      for (const entry of entries) value.add(restore(entry));
    } else if (value instanceof Error) {
      if (Object.hasOwn(value, 'cause')) value.cause = restore(value.cause);
    } else if (
      Array.isArray(value) ||
      Object.prototype.toString.call(value) === '[object Object]'
    ) {
      for (const key of Object.keys(value)) define(value, key, restore(Reflect.get(value, key)));
    }
    return value;
  }
  return restore(frame.value);
}
