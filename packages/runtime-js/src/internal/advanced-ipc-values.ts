import { Buffer, NotImplementedError } from '@riftydev/io';
import { isTrackedProxy } from './proxy-clone-guard.ts';

const nativeApply = Reflect.apply;
const nativeClone = structuredClone;
const nativeMapEntries = Map.prototype.entries;
const nativeSetValues = Set.prototype.values;
const nativeMapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const nativeSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const nativeIsView = ArrayBuffer.isView;
const sharedSize =
  typeof SharedArrayBuffer === 'undefined'
    ? null
    : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')!.get!;
const nativeIsError = Reflect.get(Error, 'isError') as ((value: unknown) => boolean) | undefined;
const nativeCoreProbes = [
  Date.prototype.getTime,
  Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!,
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!,
  Number.prototype.valueOf,
  String.prototype.valueOf,
  Boolean.prototype.valueOf,
  BigInt.prototype.valueOf,
  Symbol.prototype.valueOf,
  WeakMap.prototype.has,
  WeakSet.prototype.has,
];
const promisePrototype = Promise.prototype;
const errorPrototype = Error.prototype;
const nativeIsPrototypeOf = Object.prototype.isPrototypeOf;
function hasSlot(value: object, probe: (...args: never[]) => unknown): boolean {
  try {
    nativeApply(probe, value, []);
    return true;
  } catch {
    return false;
  }
}

interface AdvancedPayload {
  data: unknown;
  buffers: object[];
}

/** Side references preserve Buffer identity through the native structured-clone graph. */
export function encodeAdvancedIpc(message: unknown): unknown {
  const buffers: object[] = [];
  const seen = new Map<object, object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (isTrackedProxy(value)) return nativeClone(value);
    if (sharedSize && hasSlot(value, sharedSize))
      throw new NotImplementedError('child_process.serialization.advanced.SharedArrayBuffer');
    const cached = seen.get(value);
    if (cached) return cached;
    if (Buffer.isBuffer(value)) {
      seen.set(value, value);
      buffers.push(value);
      return value;
    }
    if (hasSlot(value, nativeMapSize)) {
      const copy = new Map<unknown, unknown>();
      seen.set(value, copy);
      for (const [key, item] of nativeApply(nativeMapEntries, value, []) as IterableIterator<
        [unknown, unknown]
      >)
        copy.set(visit(key), visit(item));
      return copy;
    }
    if (hasSlot(value, nativeSetSize)) {
      const copy = new Set<unknown>();
      seen.set(value, copy);
      for (const item of nativeApply(nativeSetValues, value, []) as IterableIterator<unknown>)
        copy.add(visit(item));
      return copy;
    }
    if (
      nativeIsView(value) ||
      nativeIsError?.(value) ||
      nativeCoreProbes.some((probe) => hasSlot(value, probe))
    )
      return value;
    if (
      nativeApply(nativeIsPrototypeOf, promisePrototype, [value]) ||
      nativeApply(nativeIsPrototypeOf, errorPrototype, [value])
    )
      return value;
    const copy: Record<string, unknown> = Array.isArray(value)
      ? (new Array(value.length) as unknown as Record<string, unknown>)
      : Object.create(null);
    seen.set(value, copy);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(value, key)) continue;
      Object.defineProperty(copy, key, {
        value: visit(Reflect.get(value, key)),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  };
  return nativeClone({ data: visit(message), buffers } satisfies AdvancedPayload);
}

export function decodeAdvancedIpc(payload: unknown): unknown {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as AdvancedPayload).buffers)
  ) {
    throw new TypeError('Invalid advanced IPC payload');
  }
  const envelope = payload as AdvancedPayload;
  const replacements = new Map<object, object>();
  for (const buffer of envelope.buffers) {
    if (!(buffer instanceof Uint8Array)) throw new TypeError('Invalid advanced IPC Buffer');
    replacements.set(buffer, Buffer.from(buffer));
  }
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const cached = replacements.get(value);
    if (cached) return cached;
    replacements.set(value, value);
    if (value instanceof Map) {
      const entries = [...value];
      value.clear();
      for (const [key, item] of entries) value.set(visit(key), visit(item));
    } else if (value instanceof Set) {
      const entries = [...value];
      value.clear();
      for (const item of entries) value.add(visit(item));
    } else if (!ArrayBuffer.isView(value)) {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) record[key] = visit(record[key]);
    }
    return value;
  };
  return visit(envelope.data);
}
