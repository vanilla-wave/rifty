import { Buffer, NotImplementedError } from '@riftydev/io';

export type NodeIpcSerialization = 'json' | 'advanced';

// Preflight reads internal slots, never guest iterator/buffer overrides.
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const mapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const setSizeGetter = Object.getOwnPropertyDescriptor(Set.prototype, 'size')?.get;
const sharedArrayBufferByteLengthGetter =
  typeof SharedArrayBuffer === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)?.get;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const dataViewPrototype = DataView.prototype;
const intrinsicIsPrototypeOf = Object.prototype.isPrototypeOf;
const intrinsicApply = Reflect.apply;
const intrinsicIsView = ArrayBuffer.isView;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const dataViewBufferGetter = Object.getOwnPropertyDescriptor(DataView.prototype, 'buffer')?.get;

function hasInternalSlot(getter: (() => unknown) | undefined, value: object): boolean {
  if (getter === undefined) return false;
  try {
    intrinsicApply(getter, value, []);
    return true;
  } catch {
    return false;
  }
}

function viewBacking(view: ArrayBufferView): { backing: ArrayBufferLike; dataView: boolean } {
  if (typedArrayBufferGetter === undefined || dataViewBufferGetter === undefined) {
    throw new Error('ArrayBufferView.buffer intrinsic is unavailable');
  }
  try {
    return {
      backing: intrinsicApply(typedArrayBufferGetter, view, []) as ArrayBufferLike,
      dataView: false,
    };
  } catch {
    return {
      backing: intrinsicApply(dataViewBufferGetter, view, []) as ArrayBufferLike,
      dataView: true,
    };
  }
}

interface AdvancedGraphState {
  readonly seen: WeakSet<object>;
  readonly explicitArrayBuffers: WeakSet<ArrayBuffer>;
  readonly viewBackings: WeakSet<ArrayBuffer>;
}

function assertAdvancedGraph(value: unknown, state: AdvancedGraphState): void {
  if (typeof value !== 'object' || value === null) return;
  if (Buffer.isBuffer(value)) {
    throw new NotImplementedError('child_process.serialization.advanced.Buffer');
  }
  if (hasInternalSlot(sharedArrayBufferByteLengthGetter, value)) {
    throw new Error('#<SharedArrayBuffer> could not be cloned.');
  }
  const isView = intrinsicIsView(value);
  if (isView) {
    const { backing, dataView } = viewBacking(value);
    if (!hasInternalSlot(arrayBufferByteLengthGetter, backing)) {
      throw new NotImplementedError('child_process.serialization.advanced.shared-view');
    }
    const validPrototype = intrinsicApply(
      intrinsicIsPrototypeOf,
      dataView ? dataViewPrototype : typedArrayPrototype,
      [value],
    ) as boolean;
    if (!validPrototype) {
      throw new NotImplementedError('child_process.serialization.advanced.host-object');
    }
    if (state.explicitArrayBuffers.has(backing as ArrayBuffer)) {
      throw new NotImplementedError('child_process.serialization.advanced.arraybuffer-view-alias');
    }
    state.viewBackings.add(backing as ArrayBuffer);
  }
  const isArrayBuffer = hasInternalSlot(arrayBufferByteLengthGetter, value);
  if (isArrayBuffer) {
    if (state.viewBackings.has(value as ArrayBuffer)) {
      throw new NotImplementedError('child_process.serialization.advanced.arraybuffer-view-alias');
    }
    state.explicitArrayBuffers.add(value as ArrayBuffer);
  }
  const isMap = hasInternalSlot(mapSizeGetter, value);
  const isSet = hasInternalSlot(setSizeGetter, value);
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    !isMap &&
    !isSet &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    !(value instanceof Error) &&
    !isArrayBuffer &&
    !isView &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new NotImplementedError('child_process.serialization.advanced.host-object');
  }
  if (state.seen.has(value)) return;
  state.seen.add(value);
  if (isMap) {
    intrinsicApply(mapForEach, value, [
      (entry: unknown, key: unknown) => {
        assertAdvancedGraph(key, state);
        assertAdvancedGraph(entry, state);
      },
    ]);
  } else if (isSet) {
    intrinsicApply(setForEach, value, [(entry: unknown) => assertAdvancedGraph(entry, state)]);
  }
  if (isView || isArrayBuffer) return;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) continue;
    if (value instanceof Error && key === 'stack' && !descriptor.enumerable) continue;
    if (!('value' in descriptor)) {
      throw new NotImplementedError('child_process.serialization.advanced.accessor');
    }
    assertAdvancedGraph(descriptor.value, state);
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
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    throw Object.assign(
      new TypeError(
        'The "message" argument must be one of type string, object, number, or boolean',
      ),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
  if (serialization === 'advanced') {
    assertAdvancedGraph(message, {
      seen: new WeakSet(),
      explicitArrayBuffers: new WeakSet(),
      viewBackings: new WeakSet(),
    });
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
