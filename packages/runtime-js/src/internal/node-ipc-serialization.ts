import { Buffer, NotImplementedError } from '@riftydev/io';

export type NodeIpcSerialization = 'json' | 'advanced';

function assertAdvancedGraph(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null) return;
  if (Buffer.isBuffer(value)) {
    throw new NotImplementedError('child_process.serialization.advanced.Buffer');
  }
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
    throw new Error('#<SharedArrayBuffer> could not be cloned.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    !(value instanceof Error) &&
    !(value instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new NotImplementedError('child_process.serialization.advanced.host-object');
  }
  if (seen.has(value)) return;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      assertAdvancedGraph(key, seen);
      assertAdvancedGraph(entry, seen);
    }
  } else if (value instanceof Set) {
    for (const entry of value) assertAdvancedGraph(entry, seen);
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) continue;
    if (value instanceof Error && key === 'stack' && !descriptor.enumerable) continue;
    if (!('value' in descriptor)) {
      throw new NotImplementedError('child_process.serialization.advanced.accessor');
    }
    assertAdvancedGraph(descriptor.value, seen);
  }
}

/** Node child_process IPC defaults to JSON; advanced uses the native clone boundary. */
export function serializeNodeIpcMessage(
  message: unknown,
  serialization: NodeIpcSerialization = 'json',
): unknown {
  if (message === undefined) {
    throw Object.assign(new TypeError('The "message" argument must be specified'), {
      code: 'ERR_MISSING_ARGS',
    });
  }
  const type = typeof message;
  if (type === 'function' || type === 'symbol' || (serialization === 'json' && type === 'bigint')) {
    throw Object.assign(
      new TypeError(
        'The "message" argument must be one of type string, object, number, or boolean',
      ),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
  if (serialization === 'advanced') {
    assertAdvancedGraph(message, new WeakSet());
    try {
      return structuredClone(message);
    } catch (error) {
      if (error instanceof Error && error.name === 'DataCloneError') {
        throw new Error(error.message);
      }
      throw error;
    }
  }
  const json = JSON.stringify(message);
  if (json === undefined) {
    throw new TypeError('The "message" argument could not be serialized');
  }
  return JSON.parse(json) as unknown;
}
