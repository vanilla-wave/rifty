/**
 * A view's bytes as Node reads them, through load-time intrinsics: never through
 * members a program patches (`slice`, `subarray`, species, a global
 * `Uint8Array`). Node's C++ reads a view's memory (`ArrayBufferViewContents`);
 * its JS reads whichever members its source names, so callers pick per entry
 * (measured vs Node v24.16.0, `fs/write-view-bytes-intrinsics`; do not unify):
 * `string_decoder` and lib/fs (`writeFileSync`/`appendFileSync`/`writeFile(cb)`/
 * `writeSync`/`write`) read the memory, lib/fs its length from JS `byteLength`;
 * fs/promises and stream `write` read JS `buffer`/`byteOffset`/`byteLength`.
 */
const U8 = Uint8Array;
const TypedArrayProto = Object.getPrototypeOf(U8.prototype) as object;
const getter = (proto: object, key: PropertyKey) =>
  Object.getOwnPropertyDescriptor(proto, key)?.get as (this: unknown) => unknown;
const taBuffer = getter(TypedArrayProto, 'buffer');
const taByteOffset = getter(TypedArrayProto, 'byteOffset');
const taByteLength = getter(TypedArrayProto, 'byteLength');
const taTag = getter(TypedArrayProto, Symbol.toStringTag);
const dvBuffer = getter(DataView.prototype, 'buffer');
const dvByteOffset = getter(DataView.prototype, 'byteOffset');
const dvByteLength = getter(DataView.prototype, 'byteLength');
const { apply } = Reflect;
const read = (get: (this: unknown) => unknown, view: unknown): unknown => apply(get, view, []);

/** `ArrayBuffer.isView` as at load. */
export const isView = ArrayBuffer.isView;

const abByteLength = getter(ArrayBuffer.prototype, 'byteLength');
const sabByteLength =
  typeof SharedArrayBuffer === 'function'
    ? getter(SharedArrayBuffer.prototype, 'byteLength')
    : null;
const brands = (get: ((this: unknown) => unknown) | null, value: unknown): boolean => {
  if (get === null) return false;
  try {
    read(get, value);
    return true;
  } catch {
    return false;
  }
};

/** An `ArrayBuffer` or `SharedArrayBuffer` (by internal slot, not by prototype). */
export const isAnyArrayBuffer = (value: unknown): boolean =>
  brands(abByteLength, value) || brands(sabByteLength, value);

/**
 * A fresh `Uint8Array` over `view`'s memory from `start`, `length` long (default: to the end). A detached
 * or out-of-bounds view reads as no bytes, as Node's (`%TypedArray%` getters give 0, `DataView`'s throw).
 */
export function bytesOf(view: ArrayBufferView, start = 0, length?: number): Uint8Array {
  const typed = read(taTag, view) !== undefined;
  let size: number;
  let offset: number;
  if (typed) {
    size = read(taByteLength, view) as number;
    offset = read(taByteOffset, view) as number;
  } else {
    try {
      size = read(dvByteLength, view) as number;
      offset = read(dvByteOffset, view) as number;
    } catch {
      return new U8(0);
    }
  }
  const n = length ?? size - start;
  if (n === 0) return new U8(0);
  const buffer = read(typed ? taBuffer : dvBuffer, view) as ArrayBuffer;
  return new U8(buffer, offset + start, n);
}

/** Node's `new Uint8Array(view.buffer, view.byteOffset, view.byteLength)` (fs/promises, streams). */
export function jsViewBytes(view: ArrayBufferView): Uint8Array {
  return new U8(view.buffer, view.byteOffset, view.byteLength);
}

/** A copy the caller owns (the constructor as at load: no species, no patched `slice`). */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  return new U8(bytes);
}
