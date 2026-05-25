/**
 * Per-instance method patching for Buffer (split from `buffer.ts` to keep the
 * latter under the ADR-0024 line budget).
 *
 * `tag(u8)` stamps a Uint8Array with the Buffer-style helpers via
 * `Object.defineProperty`. Returns the same array, typed as `Buffer`.
 */

import { type Encoding, compareSlices, decode, encode } from './buffer-codec.ts';

const TAG = Symbol.for('nodejs.Buffer');

/** Re-exported so `buffer.ts` and `isBuffer` agree on the brand. */
export const BUFFER_TAG = TAG;

export interface BufferMethods {
  toString(encoding?: Encoding, start?: number, end?: number): string;
  slice(start?: number, end?: number): Buffer;
  equals(other: Uint8Array): boolean;
  write(string: string, offset?: number, length?: number, encoding?: Encoding): number;
  readUInt8(offset?: number): number;
  readUInt16BE(offset?: number): number;
  readUInt16LE(offset?: number): number;
  readUInt32BE(offset?: number): number;
  readUInt32LE(offset?: number): number;
  readInt8(offset?: number): number;
  readInt16BE(offset?: number): number;
  readInt16LE(offset?: number): number;
  readInt32BE(offset?: number): number;
  readInt32LE(offset?: number): number;
  readBigUInt64BE(offset?: number): bigint;
  readBigUInt64LE(offset?: number): bigint;
  readBigInt64BE(offset?: number): bigint;
  readBigInt64LE(offset?: number): bigint;
  writeUInt8(value: number, offset?: number): number;
  writeUInt16BE(value: number, offset?: number): number;
  writeUInt16LE(value: number, offset?: number): number;
  writeUInt32BE(value: number, offset?: number): number;
  writeUInt32LE(value: number, offset?: number): number;
  writeInt8(value: number, offset?: number): number;
  writeInt16BE(value: number, offset?: number): number;
  writeInt16LE(value: number, offset?: number): number;
  writeInt32BE(value: number, offset?: number): number;
  writeInt32LE(value: number, offset?: number): number;
  writeBigUInt64BE(value: bigint, offset?: number): number;
  writeBigUInt64LE(value: bigint, offset?: number): number;
  writeBigInt64BE(value: bigint, offset?: number): number;
  writeBigInt64LE(value: bigint, offset?: number): number;
  swap16(): Buffer;
  swap32(): Buffer;
  swap64(): Buffer;
  compare(
    other: Uint8Array,
    targetStart?: number,
    targetEnd?: number,
    sourceStart?: number,
    sourceEnd?: number,
  ): -1 | 0 | 1;
}

export type Buffer = Uint8Array & BufferMethods;

function viewOf(u8: Uint8Array, offset: number, byteLen: number): DataView {
  return new DataView(u8.buffer, u8.byteOffset + offset, byteLen);
}

function defineMethod(u8: Uint8Array, name: string, value: (...args: never[]) => unknown): void {
  Object.defineProperty(u8, name, { configurable: true, writable: true, value });
}

export function tag(u8: Uint8Array): Buffer {
  (u8 as unknown as { [k: symbol]: boolean })[TAG] = true;
  defineMethod(u8, 'toString', function (
    this: Uint8Array,
    encoding: Encoding = 'utf8',
    start = 0,
    end = this.length,
  ) {
    const view = this.subarray(start, end);
    return decode(view, encoding);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'slice', function (this: Uint8Array, start?: number, end?: number) {
    return tag(this.subarray(start, end));
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'equals', function (this: Uint8Array, other: Uint8Array) {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
    return true;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'write', function (
    this: Uint8Array,
    s: string,
    offset = 0,
    _length?: number,
    _encoding: Encoding = 'utf8',
  ) {
    const bytes = encode(s, 'utf8');
    const n = Math.min(bytes.length, this.length - offset);
    this.set(bytes.subarray(0, n), offset);
    return n;
  } as (...args: never[]) => unknown);

  // ---- Integer readers ----
  defineMethod(u8, 'readUInt8', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 1).getUint8(0);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readUInt16BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getUint16(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readUInt16LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getUint16(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readUInt32BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getUint32(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readUInt32LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getUint32(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt8', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 1).getInt8(0);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt16BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getInt16(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt16LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 2).getInt16(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt32BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getInt32(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readInt32LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getInt32(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readBigUInt64BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigUint64(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readBigUInt64LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigUint64(0, true);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readBigInt64BE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigInt64(0, false);
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'readBigInt64LE', function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getBigInt64(0, true);
  } as (...args: never[]) => unknown);

  // ---- Integer writers (return the post-write offset, matching Node) ----
  defineMethod(u8, 'writeUInt8', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 1).setUint8(0, value);
    return offset + 1;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeUInt16BE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setUint16(0, value, false);
    return offset + 2;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeUInt16LE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setUint16(0, value, true);
    return offset + 2;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeUInt32BE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setUint32(0, value, false);
    return offset + 4;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeUInt32LE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setUint32(0, value, true);
    return offset + 4;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt8', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 1).setInt8(0, value);
    return offset + 1;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt16BE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setInt16(0, value, false);
    return offset + 2;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt16LE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 2).setInt16(0, value, true);
    return offset + 2;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt32BE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setInt32(0, value, false);
    return offset + 4;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeInt32LE', function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setInt32(0, value, true);
    return offset + 4;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeBigUInt64BE', function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigUint64(0, value, false);
    return offset + 8;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeBigUInt64LE', function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigUint64(0, value, true);
    return offset + 8;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeBigInt64BE', function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigInt64(0, value, false);
    return offset + 8;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'writeBigInt64LE', function (this: Uint8Array, value: bigint, offset = 0) {
    viewOf(this, offset, 8).setBigInt64(0, value, true);
    return offset + 8;
  } as (...args: never[]) => unknown);

  // ---- Byte-swap (in place; returns self) ----
  defineMethod(u8, 'swap16', function (this: Uint8Array) {
    if (this.length % 2 !== 0) {
      throw new RangeError('Buffer size must be a multiple of 16-bits');
    }
    for (let i = 0; i < this.length; i += 2) {
      const a = this[i] ?? 0;
      this[i] = this[i + 1] ?? 0;
      this[i + 1] = a;
    }
    return this as Buffer;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'swap32', function (this: Uint8Array) {
    if (this.length % 4 !== 0) {
      throw new RangeError('Buffer size must be a multiple of 32-bits');
    }
    for (let i = 0; i < this.length; i += 4) {
      const a = this[i] ?? 0;
      const b = this[i + 1] ?? 0;
      this[i] = this[i + 3] ?? 0;
      this[i + 1] = this[i + 2] ?? 0;
      this[i + 2] = b;
      this[i + 3] = a;
    }
    return this as Buffer;
  } as (...args: never[]) => unknown);
  defineMethod(u8, 'swap64', function (this: Uint8Array) {
    if (this.length % 8 !== 0) {
      throw new RangeError('Buffer size must be a multiple of 64-bits');
    }
    for (let i = 0; i < this.length; i += 8) {
      for (let j = 0; j < 4; j++) {
        const a = this[i + j] ?? 0;
        this[i + j] = this[i + 7 - j] ?? 0;
        this[i + 7 - j] = a;
      }
    }
    return this as Buffer;
  } as (...args: never[]) => unknown);

  // ---- compare (instance) ----
  defineMethod(u8, 'compare', function (
    this: Uint8Array,
    other: Uint8Array,
    targetStart = 0,
    targetEnd = other.length,
    sourceStart = 0,
    sourceEnd = this.length,
  ) {
    return compareSlices(
      this.subarray(sourceStart, sourceEnd),
      other.subarray(targetStart, targetEnd),
    );
  } as (...args: never[]) => unknown);
  return u8 as Buffer;
}
