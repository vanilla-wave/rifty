import { Buffer } from '@riftydev/io';
import { proxyCloneFailure } from './proxy-provenance.ts';

interface AdvancedFrame {
  readonly value: unknown;
  readonly buffers: readonly Uint8Array[];
}

function nativeClone(value: object): object {
  try {
    return structuredClone(value) as object;
  } catch (error) {
    if (error instanceof Error && error.name === 'DataCloneError') {
      throw new Error(`${String(value)} could not be cloned.`);
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
    if (value instanceof Map) {
      const result = new Map<unknown, unknown>();
      seen.set(value, result);
      for (const [key, entry] of Map.prototype.entries.call(value))
        result.set(copy(key), copy(entry));
      return result;
    }
    if (value instanceof Set) {
      const result = new Set<unknown>();
      seen.set(value, result);
      for (const entry of Set.prototype.values.call(value)) result.add(copy(entry));
      return result;
    }
    if (value instanceof Error) {
      const constructors: Readonly<Record<string, ErrorConstructor>> = {
        Error,
        EvalError,
        RangeError,
        ReferenceError,
        SyntaxError,
        TypeError,
        URIError,
      };
      const Constructor =
        (Object.hasOwn(constructors, value.name) ? constructors[value.name] : undefined) ?? Error;
      const result = new Constructor(value.message);
      seen.set(value, result);
      result.stack = value.stack;
      if (Object.hasOwn(value, 'cause')) result.cause = copy(value.cause);
      return result;
    }
    if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
      throw new Error('#<SharedArrayBuffer> could not be cloned.');
    }
    if (
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value) ||
      value instanceof Boolean ||
      value instanceof Number ||
      value instanceof String ||
      value instanceof WeakMap ||
      value instanceof WeakSet ||
      value instanceof Promise ||
      value instanceof WeakRef ||
      value instanceof FinalizationRegistry ||
      Object.getPrototypeOf(value) === BigInt.prototype ||
      Object.getPrototypeOf(value) === Symbol.prototype
    ) {
      const result = nativeClone(value);
      seen.set(value, result);
      return result;
    }
    const result: object = Array.isArray(value) ? new Array(value.length) : {};
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
