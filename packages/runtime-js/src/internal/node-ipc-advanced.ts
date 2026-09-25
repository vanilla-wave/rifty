import { NotImplementedError } from '@riftydev/io';

const clone = structuredClone;
const apply = Reflect.apply;
const mapEntries = Map.prototype.entries;
const setValues = Set.prototype.values;
const isView = ArrayBuffer.isView;
const isError = (Error as ErrorConstructor & { isError(value: unknown): value is Error }).isError;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const keys = Object.keys;
const arrayBufferLength = ownDescriptor(ArrayBuffer.prototype, 'byteLength')?.get;
const sharedBufferLength =
  typeof SharedArrayBuffer === 'undefined'
    ? undefined
    : ownDescriptor(SharedArrayBuffer.prototype, 'byteLength')?.get;

function slot<T>(value: object, read: ((this: never) => T) | undefined): T | undefined {
  if (!read) return undefined;
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

/** Inspect only the native snapshot: never traverse guest getters twice. */
function assertNonBinary(root: unknown): void {
  const seen = new Set<object>();
  function visit(value: unknown): void {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (
      isView(value) ||
      slot(value, arrayBufferLength) !== undefined ||
      slot(value, sharedBufferLength) !== undefined
    ) {
      throw new NotImplementedError('child_process.serialization.advanced.binary');
    }
    const entries = slot(value, mapEntries);
    if (entries !== undefined) {
      for (const [key, entry] of entries) {
        visit(key);
        visit(entry);
      }
      return;
    }
    const values = slot(value, setValues);
    if (values !== undefined) {
      for (const entry of values) visit(entry);
      return;
    }
    if (isError(value)) {
      const cause = ownDescriptor(value, 'cause');
      if (cause && 'value' in cause) visit(cause.value);
      return;
    }
    for (const key of keys(value)) {
      const descriptor = ownDescriptor(value, key);
      if (descriptor && 'value' in descriptor) visit(descriptor.value);
    }
  }
  visit(root);
}

/** One native snapshot owns intrinsic brands, getter order and clone rejection. */
export function encodeAdvancedIpc(message: unknown): AdvancedFrame {
  let value: unknown;
  try {
    value = clone(message);
  } catch (error) {
    if (error instanceof Error && error.name === 'DataCloneError') {
      throw new Error(
        error.message.replace(
          /^Failed to execute 'structuredClone' on '(?:WorkerGlobalScope|Window)': /,
          '',
        ),
      );
    }
    throw error;
  }
  assertNonBinary(value);
  return { value, buffers: [] };
}

/** Transport already cloned the frame; Buffer provenance is no longer accepted. */
export function decodeAdvancedIpc(frame: unknown): unknown {
  if (
    typeof frame !== 'object' ||
    frame === null ||
    !('value' in frame) ||
    !('buffers' in frame) ||
    !Array.isArray(frame.buffers) ||
    frame.buffers.length !== 0
  ) {
    throw new TypeError('invalid advanced IPC frame');
  }
  assertNonBinary(frame.value);
  return frame.value;
}
