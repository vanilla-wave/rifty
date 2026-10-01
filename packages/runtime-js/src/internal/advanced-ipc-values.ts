import { Buffer } from '@riftydev/io';

interface AdvancedPayload {
  data: unknown;
  buffers: object[];
}

/** Side references preserve Buffer identity through the native structured-clone graph. */
export function encodeAdvancedIpc(message: unknown): unknown {
  const buffers: object[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Buffer.isBuffer(value)) {
      buffers.push(value);
      return;
    }
    if (value instanceof Map) {
      for (const [key, item] of value) {
        visit(key);
        visit(item);
      }
    } else if (value instanceof Set) {
      for (const item of value) visit(item);
    } else if (!ArrayBuffer.isView(value)) {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(message);
  return structuredClone({ data: message, buffers } satisfies AdvancedPayload);
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
