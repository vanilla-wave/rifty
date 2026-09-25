/**
 * `serialization: 'advanced'` fork IPC codec (ADR-0448). The sending realm's
 * native structured clone decides traversal, getters, refusals and every
 * intrinsic type; this module applies Node's v8-serializer rules where the
 * browser clone differs: each ArrayBuffer view becomes its own copy of exactly
 * its bytes, a view whose `constructor` is `Buffer` arrives as a `Buffer`,
 * SharedArrayBuffer and V8-refused values throw Node's plain `Error`, and what
 * a browser clone cannot carry Node's way is a named `NotImplementedError`.
 * Wire payload: `[value, buffers]`, `buffers` listing the copies to brand.
 */

import { Buffer, NotImplementedError } from '@riftydev/io';

export type AdvancedIpcPayload = readonly [value: unknown, buffers: readonly Uint8Array[]];

type ViewConstructor = new (buffer: ArrayBuffer) => ArrayBufferView;

// Intrinsics captured before guest code runs: the codec must not observe a
// guest's patched globals or prototypes (V8's serializer does not either).
const nativeStructuredClone = globalThis.structuredClone;
const DOMExceptionClass = globalThis.DOMException;
const { getPrototypeOf, setPrototypeOf, keys, getOwnPropertyDescriptor, hasOwn } = Object;
const { apply, defineProperty } = Reflect;
const { isArray } = Array;
const { isView } = ArrayBuffer;
const ObjectPrototype = Object.prototype;
const ArrayPrototype = Array.prototype;
const MapPrototype = Map.prototype;
const SetPrototype = Set.prototype;
const Uint8ArrayClass = Uint8Array;
const TypedArrayPrototype = getPrototypeOf(Uint8Array.prototype) as object;
const getter = (owner: object, key: string): ((this: unknown) => unknown) =>
  getOwnPropertyDescriptor(owner, key)?.get as (this: unknown) => unknown;
const typedArrayBuffer = getter(TypedArrayPrototype, 'buffer');
const typedArrayByteOffset = getter(TypedArrayPrototype, 'byteOffset');
const typedArrayByteLength = getter(TypedArrayPrototype, 'byteLength');
const dataViewBuffer = getter(DataView.prototype, 'buffer');
const dataViewByteOffset = getter(DataView.prototype, 'byteOffset');
const dataViewByteLength = getter(DataView.prototype, 'byteLength');
const typedArraySet = getOwnPropertyDescriptor(TypedArrayPrototype, 'set')?.value as (
  this: Uint8Array,
  source: Uint8Array,
) => void;
const mapSize = getter(MapPrototype, 'size');
const mapForEach = MapPrototype.forEach;
const mapClear = MapPrototype.clear;
const mapSet = MapPrototype.set;
const setSize = getter(SetPrototype, 'size');
const setForEach = SetPrototype.forEach;
const setClear = SetPrototype.clear;
const setAdd = SetPrototype.add;
const SharedArrayBufferPrototype =
  typeof SharedArrayBuffer === 'function' ? SharedArrayBuffer.prototype : null;
/** Cross-copy brand the prod bundle's duplicated `Buffer` classes share (`@riftydev/io`). */
const BUFFER_BRAND = Symbol.for('@riftydev/io.Buffer');

const ERROR_PROTOTYPES = new Set<object>(
  [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError].map(
    (ctor) => ctor.prototype,
  ),
);
/** Prototypes V8 deserializes that hold no traversed children. */
const LEAF_PROTOTYPES = new Set<object>([
  Date.prototype,
  RegExp.prototype,
  ArrayBuffer.prototype,
  Boolean.prototype,
  Number.prototype,
  String.prototype,
  BigInt.prototype,
]);
const VIEW_CONSTRUCTORS = new Map<object, ViewConstructor>(
  [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    (globalThis as unknown as { Float16Array?: ViewConstructor }).Float16Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    DataView,
  ]
    .filter((ctor): ctor is ViewConstructor => typeof ctor === 'function')
    .map((ctor) => [ctor.prototype as object, ctor]),
);

const DETACHED_TEXT = 'An ArrayBuffer is detached and could not be cloned.';

function unsupported(
  kind: 'host-object' | 'detached-array-buffer' | 'accessor-with-view',
  hint: string,
): NotImplementedError {
  return new NotImplementedError(`child_process.serialization.advanced.${kind}`, hint);
}

const hostObject = (): NotImplementedError =>
  unsupported('host-object', "Node's serializer writes platform objects its own way");
const brandUnknowable = (): NotImplementedError =>
  unsupported(
    'accessor-with-view',
    'a Buffer brand behind an accessor is unknowable after the clone',
  );

/** A `structuredClone` refusal as Node's serializer reports it. */
function nodeRefusal(error: unknown): unknown {
  if (
    typeof DOMExceptionClass !== 'function' ||
    !(error instanceof DOMExceptionClass) ||
    error.name !== 'DataCloneError'
  ) {
    return error; // a getter's own error propagates unchanged
  }
  const text = error.message.replace(/^Failed to execute '[^']*' on '[^']*': /u, '');
  if (text === DETACHED_TEXT) {
    return unsupported(
      'detached-array-buffer',
      'Node words a detached buffer and a view over one differently',
    );
  }
  // V8's own text; Blink's platform-object form is `<Interface> object could not be cloned.`.
  if (
    /could not be cloned\.$/u.test(text) &&
    !/^[A-Za-z]\w* object could not be cloned\.$/u.test(text)
  ) {
    return new Error(text);
  }
  return hostObject();
}

/** Own children V8 traversed in one cloned node, with a writer for each slot. */
function forEachSlot(
  node: object,
  visit: (value: unknown, write: (next: unknown) => void) => void,
): void {
  const proto = getPrototypeOf(node);
  if (proto === ObjectPrototype || proto === ArrayPrototype) {
    for (const key of keys(node)) {
      visit((node as Record<string, unknown>)[key], (next) => {
        defineProperty(node, key, { value: next });
      });
    }
  } else if (proto === MapPrototype || proto === SetPrototype) {
    const isMap = proto === MapPrototype;
    const entries: [unknown, unknown][] = [];
    apply(isMap ? mapForEach : setForEach, node, [
      (value: unknown, key: unknown) => entries.push([key, value]),
    ]);
    let changed = false;
    for (const entry of entries) {
      const write = (index: 0 | 1) => (next: unknown) => {
        entry[index] = next;
        changed = true;
      };
      visit(entry[0], write(0));
      if (isMap) visit(entry[1], write(1));
    }
    if (!changed) return;
    // Rebuilt in order: a replaced key keeps its position.
    apply(isMap ? mapClear : setClear, node, []);
    for (const [key, value] of entries) {
      if (isMap) apply(mapSet, node, [key, value]);
      else apply(setAdd, node, [key]);
    }
  } else if (ERROR_PROTOTYPES.has(proto) && hasOwn(node, 'cause')) {
    visit((node as { cause?: unknown }).cause, (next) => {
      defineProperty(node, 'cause', { value: next });
    });
  }
}

/** Refuses what Node refuses or what the clone cannot carry; lists the clone's views. */
function cloneViews(root: unknown): Set<ArrayBufferView> {
  const views = new Set<ArrayBufferView>();
  const seen = new Set<object>();
  const pending = [root];
  let host = false;
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node !== 'object' || node === null || seen.has(node)) continue;
    seen.add(node);
    const proto = getPrototypeOf(node);
    if (proto === SharedArrayBufferPrototype) {
      throw new Error('#<SharedArrayBuffer> could not be cloned.');
    }
    if (VIEW_CONSTRUCTORS.has(proto)) {
      views.add(node as ArrayBufferView);
    } else if (
      proto !== ObjectPrototype &&
      proto !== ArrayPrototype &&
      proto !== MapPrototype &&
      proto !== SetPrototype &&
      !ERROR_PROTOTYPES.has(proto) &&
      !LEAF_PROTOTYPES.has(proto)
    ) {
      // Node would still stop at a later SharedArrayBuffer: keep walking.
      host = true;
    } else {
      forEachSlot(node, (value) => pending.push(value));
    }
  }
  if (host) throw hostObject();
  return views;
}

/** `constructor` names one of rifty's `Buffer` class copies (Node: `=== Buffer`). */
function isBufferClass(value: unknown): boolean {
  if (value === Buffer) return true;
  if (typeof value !== 'function') return false;
  const prototype = getOwnPropertyDescriptor(value, 'prototype')?.value as unknown;
  if (typeof prototype !== 'object' || prototype === null) return false;
  return getOwnPropertyDescriptor(prototype, BUFFER_BRAND)?.value === true;
}

function sizeOf(size: (this: unknown) => unknown, value: object): unknown {
  try {
    return apply(size, value, []);
  } catch {
    throw brandUnknowable();
  }
}

function entriesOf(node: object, isMap: boolean): unknown[] {
  const out: unknown[] = [];
  apply(isMap ? mapForEach : setForEach, node, [
    (value: unknown, key: unknown) => {
      out.push(key);
      if (isMap) out.push(value);
    },
  ]);
  return out;
}

/**
 * The clone views whose original `constructor` is `Buffer`, read once as
 * Node's `_writeHostObject` does, by walking the message beside its clone
 * along what V8 traversed. An own accessor or a diverged graph makes the brand
 * unknowable.
 */
function bufferViews(message: unknown, clone: unknown): Set<ArrayBufferView> {
  const branded = new Set<ArrayBufferView>();
  const paired = new Map<object, object>();
  const pending: [unknown, unknown][] = [[message, clone]];
  while (pending.length > 0) {
    const [original, copy] = pending.pop() as [unknown, unknown];
    if (typeof copy !== 'object' || copy === null) {
      if (typeof original === 'object' && original !== null) throw brandUnknowable();
      continue;
    }
    if (typeof original !== 'object' || original === null) throw brandUnknowable();
    const prior = paired.get(copy);
    if (prior !== undefined) {
      if (prior !== original) throw brandUnknowable();
      continue;
    }
    paired.set(copy, original);
    const proto = getPrototypeOf(copy);
    if (VIEW_CONSTRUCTORS.has(proto)) {
      if (!isView(original)) throw brandUnknowable();
      if (isBufferClass((original as { constructor?: unknown }).constructor)) {
        branded.add(copy as ArrayBufferView);
      }
    } else if (proto === ObjectPrototype || proto === ArrayPrototype) {
      if (isArray(original) !== (proto === ArrayPrototype)) throw brandUnknowable();
      const originalKeys = keys(original);
      const copyKeys = keys(copy);
      if (originalKeys.length !== copyKeys.length) throw brandUnknowable();
      for (let index = 0; index < copyKeys.length; index++) {
        const key = copyKeys[index] as string;
        const descriptor = getOwnPropertyDescriptor(original, key);
        if (originalKeys[index] !== key || descriptor === undefined || !('value' in descriptor)) {
          throw brandUnknowable();
        }
        pending.push([descriptor.value, (copy as Record<string, unknown>)[key]]);
      }
    } else if (proto === MapPrototype || proto === SetPrototype) {
      const isMap = proto === MapPrototype;
      const size = isMap ? mapSize : setSize;
      if (sizeOf(size, original) !== sizeOf(size, copy)) throw brandUnknowable();
      const originalEntries = entriesOf(original, isMap);
      const copyEntries = entriesOf(copy, isMap);
      for (let index = 0; index < copyEntries.length; index++) {
        pending.push([originalEntries[index], copyEntries[index]]);
      }
    } else if (ERROR_PROTOTYPES.has(proto) && hasOwn(copy, 'cause')) {
      const descriptor = getOwnPropertyDescriptor(original, 'cause');
      if (descriptor === undefined || !('value' in descriptor)) throw brandUnknowable();
      pending.push([descriptor.value, (copy as { cause?: unknown }).cause]);
    }
  }
  return branded;
}

/** A fresh copy of exactly the view's bytes, never its whole or shared backing buffer. */
function viewBytes(view: ArrayBufferView): Uint8Array {
  const typed = getPrototypeOf(view) !== DataView.prototype;
  const buffer = apply(typed ? typedArrayBuffer : dataViewBuffer, view, []) as ArrayBuffer;
  const offset = apply(typed ? typedArrayByteOffset : dataViewByteOffset, view, []) as number;
  const length = apply(typed ? typedArrayByteLength : dataViewByteLength, view, []) as number;
  const bytes = new Uint8ArrayClass(length);
  apply(typedArraySet, bytes, [new Uint8ArrayClass(buffer, offset, length)]);
  return bytes;
}

/** Encodes one validated message for `serialization: 'advanced'`. */
export function encodeAdvancedIpcMessage(message: unknown): AdvancedIpcPayload {
  let clone: unknown;
  try {
    clone = nativeStructuredClone(message);
  } catch (error) {
    throw nodeRefusal(error);
  }
  const views = cloneViews(clone);
  if (views.size === 0) return [clone, []];
  const branded = bufferViews(message, clone);
  const buffers: Uint8Array[] = [];
  const copies = new Map<ArrayBufferView, ArrayBufferView>();
  const copyOf = (view: ArrayBufferView): ArrayBufferView => {
    let copy = copies.get(view);
    if (copy !== undefined) return copy;
    const bytes = viewBytes(view);
    if (branded.has(view)) {
      buffers.push(bytes);
      copy = bytes;
    } else {
      const View = VIEW_CONSTRUCTORS.get(getPrototypeOf(view)) as ViewConstructor;
      copy = View === Uint8ArrayClass ? bytes : new View(bytes.buffer as ArrayBuffer);
    }
    copies.set(view, copy);
    return copy;
  };
  const seen = new Set<object>();
  const pending = [clone];
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node !== 'object' || node === null || seen.has(node)) continue;
    seen.add(node);
    forEachSlot(node, (value, write) => {
      if (views.has(value as ArrayBufferView)) write(copyOf(value as ArrayBufferView));
      else pending.push(value);
    });
  }
  const root = views.has(clone as ArrayBufferView) ? copyOf(clone as ArrayBufferView) : clone;
  return [root, buffers];
}

/** Delivers one advanced payload: listed copies take this realm's `Buffer` prototype. */
export function decodeAdvancedIpcMessage(payload: unknown): unknown {
  if (!isArray(payload) || payload.length !== 2 || !isArray(payload[1])) {
    throw new TypeError('advanced IPC payload must be [value, buffers]');
  }
  for (const bytes of payload[1] as unknown[]) {
    if (
      typeof bytes !== 'object' ||
      bytes === null ||
      getPrototypeOf(bytes) !== Uint8ArrayClass.prototype
    ) {
      throw new TypeError('advanced IPC payload buffers must be Uint8Array copies');
    }
    setPrototypeOf(bytes, Buffer.prototype);
  }
  return payload[0];
}
