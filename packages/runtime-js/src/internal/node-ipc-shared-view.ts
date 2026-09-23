const apply = Reflect.apply;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get as (
  this: never,
) => ArrayBufferLike;
const typedOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')?.get as (
  this: never,
) => number;
const typedLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get as (
  this: never,
) => number;
const typedTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get as (
  this: never,
) => string | undefined;
const dataBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, 'buffer')?.get as (
  this: never,
) => ArrayBuffer;
const dataOffset = Object.getOwnPropertyDescriptor(DataView.prototype, 'byteOffset')?.get as (
  this: never,
) => number;
const dataLength = Object.getOwnPropertyDescriptor(DataView.prototype, 'byteLength')?.get as (
  this: never,
) => number;
const sharedLength =
  typeof SharedArrayBuffer === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength')?.get;
const ArrayBufferCtor = ArrayBuffer;
const Uint8ArrayCtor = Uint8Array;
const DataViewCtor = DataView;
const setBytes = Uint8Array.prototype.set;
type ViewConstructor = new (buffer: ArrayBuffer) => ArrayBufferView;
const constructors: Readonly<Record<string, ViewConstructor | undefined>> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float16Array: (globalThis as typeof globalThis & { Float16Array?: ViewConstructor }).Float16Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
};

/** Native-cloned views still share SAB memory; IPC snapshots each view at encounter. */
export function snapshotSharedView(view: object): object {
  if (!sharedLength) return view;
  const tag = apply(typedTag, view, []) as string | undefined;
  const buffer = apply(tag === undefined ? dataBuffer : typedBuffer, view, []) as ArrayBufferLike;
  try {
    apply(sharedLength, buffer, []);
  } catch {
    return view;
  }
  const offset = apply(tag === undefined ? dataOffset : typedOffset, view, []) as number;
  const length = apply(tag === undefined ? dataLength : typedLength, view, []) as number;
  const snapshot = new ArrayBufferCtor(length);
  apply(setBytes, new Uint8ArrayCtor(snapshot), [new Uint8ArrayCtor(buffer, offset, length)]);
  if (tag === undefined) return new DataViewCtor(snapshot);
  const Constructor = constructors[tag];
  if (!Constructor) throw new TypeError(`Unsupported intrinsic typed array: ${tag}`);
  return new Constructor(snapshot);
}
