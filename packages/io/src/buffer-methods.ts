/**
 * Per-instance method patching for Buffer (split from `buffer.ts` to keep the
 * latter under the ADR-0024 line budget).
 *
 * `tag(u8)` stamps a Uint8Array with the Buffer-style helpers via
 * `Object.defineProperty`. Returns the same array, typed as `Buffer`.
 */

import { type Encoding, compareSlices, decode, encode } from './buffer-codec.ts';
import { tagExtra } from './buffer-methods-extra.ts';
import { tagInt } from './buffer-methods-int.ts';

const TAG = Symbol.for('nodejs.Buffer');

/** Re-exported so `buffer.ts` and `isBuffer` agree on the brand. */
export const BUFFER_TAG = TAG;

export interface BufferMethods {
  toString(encoding?: Encoding, start?: number, end?: number): string;
  slice(start?: number, end?: number): Buffer;
  equals(other: Uint8Array): boolean;
  write(string: string, encoding?: Encoding): number;
  write(string: string, offset: number, encoding?: Encoding): number;
  write(string: string, offset: number, length: number, encoding?: Encoding): number;
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
  readFloatBE(offset?: number): number;
  readFloatLE(offset?: number): number;
  readDoubleBE(offset?: number): number;
  readDoubleLE(offset?: number): number;
  writeFloatBE(value: number, offset?: number): number;
  writeFloatLE(value: number, offset?: number): number;
  writeDoubleBE(value: number, offset?: number): number;
  writeDoubleLE(value: number, offset?: number): number;
  indexOf(
    value: number | string | Uint8Array,
    byteOffsetOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ): number;
  lastIndexOf(
    value: number | string | Uint8Array,
    byteOffsetOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ): number;
  includes(
    value: number | string | Uint8Array,
    byteOffsetOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ): boolean;
  fill(
    value: number | string | Uint8Array,
    offsetOrEncoding?: number | Encoding,
    endOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ): Buffer;
  copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
}

export type Buffer = Uint8Array & BufferMethods;

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
    offsetOrEncoding?: number | Encoding,
    lengthOrEncoding?: number | Encoding,
    encodingArg?: Encoding,
  ) {
    // Node overloads: write(s) / write(s, encoding) / write(s, offset, encoding)
    // / write(s, offset, length, encoding). Resolve to (offset, length, encoding).
    let offset: number;
    let length: number | undefined;
    let encoding: Encoding;

    if (typeof offsetOrEncoding === 'string') {
      // write(s, encoding)
      offset = 0;
      length = undefined;
      encoding = offsetOrEncoding;
    } else {
      offset = offsetOrEncoding ?? 0;
      if (typeof lengthOrEncoding === 'string') {
        // write(s, offset, encoding)
        length = undefined;
        encoding = lengthOrEncoding;
      } else {
        length = lengthOrEncoding;
        encoding = encodingArg ?? 'utf8';
      }
    }

    if (offset < 0 || offset > this.length) {
      throw new RangeError(
        `The value of "offset" is out of range. It must be >= 0 && <= ${this.length}. Received ${offset}`,
      );
    }
    if (length === undefined) length = this.length - offset;
    if (length < 0 || length > this.length) {
      throw new RangeError(
        `The value of "length" is out of range. It must be >= 0 && <= ${this.length}. Received ${length}`,
      );
    }

    const bytes = encode(s, encoding);
    const n = Math.min(bytes.length, length, this.length - offset);
    this.set(bytes.subarray(0, n), offset);
    return n;
  } as (...args: never[]) => unknown);

  // Integer/BigInt readers + writers live in `buffer-methods-int.ts`.
  tagInt(u8);

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

  // Float/Double/indexOf/fill/copy live in `buffer-methods-extra.ts` to keep
  // both files under the ADR-0024 line budget.
  tagExtra(u8);
  return u8 as Buffer;
}
