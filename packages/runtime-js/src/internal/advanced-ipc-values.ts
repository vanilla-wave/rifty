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

/** Walk only edges retained by native clone; source accessors have already run. */
function mapClonedGraph(data: unknown, transform: (value: object) => object): unknown {
  const seen = new Map<object, object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const cached = seen.get(value);
    if (cached) return cached;
    const mapped = transform(value);
    seen.set(value, mapped);
    if (mapped !== value) return mapped;
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
    } else if (nativeIsError?.(value)) {
      const cause = Object.getOwnPropertyDescriptor(value, 'cause');
      if (cause) Object.defineProperty(value, 'cause', { ...cause, value: visit(cause.value) });
    } else if (!nativeIsView(value) && !coreProbes.some((probe) => hasSlot(value, probe))) {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) record[key] = visit(record[key]);
    }
    return value;
  };
  return visit(data);
}

/** Clone original graph once; the later getter includes Buffers created by data getters. */
export function encodeAdvancedIpc(message: unknown): unknown {
  const packet = nativeClone({
    data: message,
    get buffers() {
      return getLiveBufferCloneRefs();
    },
  }) as AdvancedPayload;
  mapClonedGraph(packet.data, (value) => {
    // TODO(backlog: runtime-js/advanced-ipc-shared-backing-stores)
    if (
      (sharedSize && hasSlot(value, sharedSize)) ||
      (nativeIsView(value) && sharedSize && hasSlot(value.buffer, sharedSize))
    )
      throw new NotImplementedError('child_process.serialization.advanced.SharedArrayBuffer');
    if (
      nativeIsView(value) ||
      nativeIsError?.(value) ||
      coreProbes.some((probe) => hasSlot(value, probe)) ||
      hasSlot(value, nativeMapSize) ||
      hasSlot(value, nativeSetSize)
    )
      return value;
    // TODO(backlog: runtime-js/advanced-ipc-web-object-values)
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
      throw new NotImplementedError('child_process.serialization.advanced.WebObject');
    return value;
  });
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
  return mapClonedGraph(envelope.data, (value) =>
    buffers.has(value) ? Buffer.from(value as Uint8Array) : value,
  );
}
