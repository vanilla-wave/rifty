import { Buffer } from '@riftydev/io';
import { isTrackedProxy } from './proxy-clone-guard.ts';

const nativeFunctionToString = Function.prototype.toString;
const nativeMapEntries = Map.prototype.entries;
const nativeSetValues = Set.prototype.values;
// V8 serializes web values as ordinary own-property records, not host clones.
const ordinaryWebPrototypes = new Set<object>();
for (const name of ['Blob', 'File', 'URL', 'URLSearchParams', 'DOMException']) {
  const constructor = Reflect.get(globalThis, name);
  if (typeof constructor === 'function') ordinaryWebPrototypes.add(constructor.prototype);
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
    if (isTrackedProxy(value)) return structuredClone(value);
    const cached = seen.get(value);
    if (cached) return cached;
    if (Buffer.isBuffer(value)) {
      seen.set(value, value);
      buffers.push(value);
      return value;
    }
    if (value instanceof Map) {
      const copy = new Map<unknown, unknown>();
      seen.set(value, copy);
      for (const [key, item] of nativeMapEntries.call(value)) copy.set(visit(key), visit(item));
      return copy;
    }
    if (value instanceof Set) {
      const copy = new Set<unknown>();
      seen.set(value, copy);
      for (const item of nativeSetValues.call(value)) copy.add(visit(item));
      return copy;
    }
    // Native branded values keep native clone semantics (including rejection).
    // Ordinary objects/arrays snapshot enumerable getters exactly once.
    let proto = Object.getPrototypeOf(value);
    while (proto && proto !== Object.prototype && proto !== Array.prototype) {
      if (ordinaryWebPrototypes.has(proto)) break;
      const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value;
      if (typeof ctor === 'function' && /\[native code\]/.test(nativeFunctionToString.call(ctor)))
        return value;
      proto = Object.getPrototypeOf(proto);
    }
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
  return structuredClone({ data: visit(message), buffers } satisfies AdvancedPayload);
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
