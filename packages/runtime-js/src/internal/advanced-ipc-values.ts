import { Buffer, NotImplementedError, getLiveBufferCloneRefs } from '@riftydev/io';

const nativeClone = structuredClone;
const nativeApply = Reflect.apply;
const nativeMapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const nativeSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const nativeMapEntries = Map.prototype.entries;
const nativeSetValues = Set.prototype.values;
const nativeIsView = ArrayBuffer.isView;
const sharedSize =
  typeof SharedArrayBuffer === 'undefined'
    ? null
    : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')!.get!;
const nativeIsError = Reflect.get(Error, 'isError') as ((value: unknown) => boolean) | undefined;
const coreProbes = [
  Date.prototype.getTime,
  Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!,
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!,
  Number.prototype.valueOf,
  String.prototype.valueOf,
  Boolean.prototype.valueOf,
  BigInt.prototype.valueOf,
];
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

/** Clone original graph once; the later getter includes Buffers created by data getters. */
export function encodeAdvancedIpc(message: unknown): unknown {
  const packet = nativeClone({
    data: message,
    get buffers() {
      return getLiveBufferCloneRefs();
    },
  }) as AdvancedPayload;
  const buffers = new Set(packet.buffers);
  const seen = new Set<object>();
  const validate = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    // TODO(backlog: runtime-js/advanced-ipc-shared-backing-stores)
    if (nativeIsView(value) && sharedSize && hasSlot(value.buffer, sharedSize))
      throw new NotImplementedError('child_process.serialization.advanced.SharedArrayBuffer');
    if (buffers.has(value)) return;
    if (sharedSize && hasSlot(value, sharedSize))
      throw new NotImplementedError('child_process.serialization.advanced.SharedArrayBuffer');
    if (nativeIsView(value)) {
      if (sharedSize && hasSlot(value.buffer, sharedSize))
        throw new NotImplementedError('child_process.serialization.advanced.SharedArrayBuffer');
      return;
    }
    if (hasSlot(value, nativeMapSize)) {
      for (const [key, item] of nativeApply(nativeMapEntries, value, []) as IterableIterator<
        [unknown, unknown]
      >) {
        validate(key);
        validate(item);
      }
      return;
    }
    if (hasSlot(value, nativeSetSize)) {
      for (const item of nativeApply(nativeSetValues, value, []) as IterableIterator<unknown>)
        validate(item);
      return;
    }
    if (nativeIsError?.(value) || coreProbes.some((probe) => hasSlot(value, probe))) return;
    // TODO(backlog: runtime-js/advanced-ipc-web-object-values)
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
      throw new NotImplementedError('child_process.serialization.advanced.WebObject');
    for (const key of Object.keys(value)) validate(Reflect.get(value, key));
  };
  validate(packet.data);
  return packet;
}

export function decodeAdvancedIpc(payload: unknown): unknown {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as AdvancedPayload).buffers)
  )
    throw new TypeError('Invalid advanced IPC payload');
  const envelope = payload as AdvancedPayload;
  const buffers = new Set<object>();
  for (const buffer of envelope.buffers) {
    if (!(buffer instanceof Uint8Array)) throw new TypeError('Invalid advanced IPC Buffer');
    buffers.add(buffer);
  }
  const replacements = new Map<object, object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const cached = replacements.get(value);
    if (cached) return cached;
    if (buffers.has(value)) {
      const result = Buffer.from(value as Uint8Array);
      replacements.set(value, result);
      return result;
    }
    replacements.set(value, value);
    if (hasSlot(value, nativeMapSize)) {
      const entries = [
        ...(nativeApply(nativeMapEntries, value, []) as IterableIterator<[unknown, unknown]>),
      ];
      const map = value as Map<unknown, unknown>;
      map.clear();
      for (const [key, item] of entries) map.set(visit(key), visit(item));
    } else if (hasSlot(value, nativeSetSize)) {
      const entries = [...(nativeApply(nativeSetValues, value, []) as IterableIterator<unknown>)];
      const set = value as Set<unknown>;
      set.clear();
      for (const item of entries) set.add(visit(item));
    } else if (!nativeIsView(value)) {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) record[key] = visit(record[key]);
    }
    return value;
  };
  return visit(envelope.data);
}
