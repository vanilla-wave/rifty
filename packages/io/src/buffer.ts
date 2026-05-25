/**
 * Node-compatible `node:buffer` — `Buffer` is a real subclass of `Uint8Array`
 * (ADR-0030), so `subarray()` / `slice()` / structured-clone preserve the
 * Buffer brand via `Symbol.species`, and `instanceof Uint8Array` is `true`.
 *
 * Statics: `from`, `alloc`, `allocUnsafe`, `concat`, `byteLength`, `isBuffer`,
 * `compare`. Instance methods cover: toString, equals, write, swap16/32/64,
 * compare, copy, fill, indexOf/lastIndexOf/includes, read/write{Int,UInt}8/16/32
 * and BigInt64 LE/BE, read/writeFloat/Double LE/BE.
 *
 * Per-instance methods live on the class prototype. Their runtime
 * implementations are installed by `installCoreMethods` / `installIntMethods`
 * / `installExtraMethods` from sibling files (one file per group) so this
 * file stays under the ADR-0024 line budget. The type signatures live here
 * (using `declare` on the class body) so the prototype-installer files do
 * not need to import the `Buffer` type back from this file — avoiding a
 * runtime circular dependency that `pnpm check:deps` would flag.
 */

import { type Encoding, compareSlices, encode } from './buffer-codec.ts';
import { installCoreMethods } from './buffer-prototype-core.ts';
import { installExtraMethods } from './buffer-prototype-extra.ts';
import { installIntMethods } from './buffer-prototype-int.ts';

export type { Encoding };

export class Buffer extends Uint8Array {
  /**
   * Ensure `subarray()` / `slice()` and similar typed-array operations that
   * use `Symbol.species` return a `Buffer`, not a plain `Uint8Array`.
   */
  static get [Symbol.species](): typeof Uint8Array {
    return Buffer as unknown as typeof Uint8Array;
  }

  // ---- prototype-method signatures (impls installed by helper files) ----

  declare toString: (encoding?: Encoding, start?: number, end?: number) => string;
  declare equals: (other: Uint8Array) => boolean;
  declare write: {
    (string: string, encoding?: Encoding): number;
    (string: string, offset: number, encoding?: Encoding): number;
    (string: string, offset: number, length: number, encoding?: Encoding): number;
  };
  declare swap16: () => Buffer;
  declare swap32: () => Buffer;
  declare swap64: () => Buffer;
  declare compare: (
    other: Uint8Array,
    targetStart?: number,
    targetEnd?: number,
    sourceStart?: number,
    sourceEnd?: number,
  ) => -1 | 0 | 1;
  declare readUInt8: (offset?: number) => number;
  declare readUInt16BE: (offset?: number) => number;
  declare readUInt16LE: (offset?: number) => number;
  declare readUInt32BE: (offset?: number) => number;
  declare readUInt32LE: (offset?: number) => number;
  declare readInt8: (offset?: number) => number;
  declare readInt16BE: (offset?: number) => number;
  declare readInt16LE: (offset?: number) => number;
  declare readInt32BE: (offset?: number) => number;
  declare readInt32LE: (offset?: number) => number;
  declare readBigUInt64BE: (offset?: number) => bigint;
  declare readBigUInt64LE: (offset?: number) => bigint;
  declare readBigInt64BE: (offset?: number) => bigint;
  declare readBigInt64LE: (offset?: number) => bigint;
  declare writeUInt8: (value: number, offset?: number) => number;
  declare writeUInt16BE: (value: number, offset?: number) => number;
  declare writeUInt16LE: (value: number, offset?: number) => number;
  declare writeUInt32BE: (value: number, offset?: number) => number;
  declare writeUInt32LE: (value: number, offset?: number) => number;
  declare writeInt8: (value: number, offset?: number) => number;
  declare writeInt16BE: (value: number, offset?: number) => number;
  declare writeInt16LE: (value: number, offset?: number) => number;
  declare writeInt32BE: (value: number, offset?: number) => number;
  declare writeInt32LE: (value: number, offset?: number) => number;
  declare writeBigUInt64BE: (value: bigint, offset?: number) => number;
  declare writeBigUInt64LE: (value: bigint, offset?: number) => number;
  declare writeBigInt64BE: (value: bigint, offset?: number) => number;
  declare writeBigInt64LE: (value: bigint, offset?: number) => number;
  declare readFloatBE: (offset?: number) => number;
  declare readFloatLE: (offset?: number) => number;
  declare readDoubleBE: (offset?: number) => number;
  declare readDoubleLE: (offset?: number) => number;
  declare writeFloatBE: (value: number, offset?: number) => number;
  declare writeFloatLE: (value: number, offset?: number) => number;
  declare writeDoubleBE: (value: number, offset?: number) => number;
  declare writeDoubleLE: (value: number, offset?: number) => number;
  declare indexOf: (
    value: number | string | Uint8Array,
    byteOffsetOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ) => number;
  declare lastIndexOf: (
    value: number | string | Uint8Array,
    byteOffsetOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ) => number;
  declare includes: (
    value: number | string | Uint8Array,
    byteOffsetOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ) => boolean;
  // `fill` overrides the Uint8Array signature with the wider Node form. The
  // `declare` shadows the base's `fill` so callers see the Buffer-shaped one.
  declare fill: (
    value: number | string | Uint8Array,
    offsetOrEncoding?: number | Encoding,
    endOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ) => this;
  declare copy: (
    target: Uint8Array,
    targetStart?: number,
    sourceStart?: number,
    sourceEnd?: number,
  ) => number;

  // ---- statics ----

  static alloc(size: number, fill?: number | string, encoding?: Encoding): Buffer {
    const buf = new Buffer(size);
    if (fill !== undefined) {
      if (typeof fill === 'number') {
        Uint8Array.prototype.fill.call(buf, fill);
      } else {
        const bytes = encode(fill, encoding ?? 'utf8');
        if (bytes.length > 0) {
          let pos = 0;
          while (pos < size) {
            const take = Math.min(bytes.length, size - pos);
            buf.set(bytes.subarray(0, take), pos);
            pos += take;
          }
        }
      }
    }
    return buf;
  }

  static allocUnsafe(size: number): Buffer {
    return new Buffer(size);
  }

  // Node's `Buffer.from` widens `Uint8Array.from`. We declare explicit overloads
  // covering both shapes so the static side remains assignable to the base
  // `typeof Uint8Array` while preserving Node's calling conventions.
  static override from(value: string, encoding?: Encoding): Buffer;
  static override from(value: ArrayBuffer, offset?: number, length?: number): Buffer;
  static override from(value: Uint8Array): Buffer;
  static override from(value: ArrayLike<number>): Buffer;
  static override from(value: Iterable<number>): Buffer;
  static override from(
    value: string | ArrayBuffer | ArrayLike<number> | Uint8Array | Iterable<number>,
    encodingOrOffset?: Encoding | number,
    length?: number,
  ): Buffer {
    if (typeof value === 'string') {
      const bytes = encode(value, (encodingOrOffset as Encoding) ?? 'utf8');
      const buf = new Buffer(bytes.length);
      buf.set(bytes);
      return buf;
    }
    if (value instanceof Uint8Array) {
      // Copy, matching Node's `Buffer.from(uint8)` semantics.
      const copy = new Buffer(value.length);
      copy.set(value);
      return copy;
    }
    if (value instanceof ArrayBuffer) {
      const offset = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
      const src = new Uint8Array(value, offset, length);
      const out = new Buffer(src.length);
      out.set(src);
      return out;
    }
    // ArrayLike<number> | Iterable<number>
    const arr =
      typeof (value as ArrayLike<number>).length === 'number'
        ? (value as ArrayLike<number>)
        : Array.from(value as Iterable<number>);
    const out = new Buffer(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] ?? 0;
    return out;
  }

  static concat(list: readonly Uint8Array[], totalLength?: number): Buffer {
    let len = totalLength;
    if (len === undefined) {
      len = 0;
      for (const a of list) len += a.length;
    }
    const out = new Buffer(len);
    let offset = 0;
    for (const a of list) {
      const remaining = len - offset;
      const take = a.subarray(0, Math.min(a.length, remaining));
      out.set(take, offset);
      offset += take.length;
      if (offset >= len) break;
    }
    return out;
  }

  static byteLength(s: string, encoding: Encoding = 'utf8'): number {
    return encode(s, encoding).length;
  }

  static isBuffer(v: unknown): boolean {
    return v instanceof Buffer;
  }

  static compare(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
    return compareSlices(a, b);
  }
}

// Install per-instance method implementations onto `Buffer.prototype`. The
// helper files take the class as an opaque constructor (no type-back imports)
// so madge sees no circular reference between this file and the helpers.
installCoreMethods(Buffer);
installIntMethods(Buffer);
installExtraMethods(Buffer);

export type BufferLike = Buffer;

export default { Buffer };
