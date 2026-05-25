/**
 * Core prototype methods for `Buffer` (ADR-0030). Split out of `buffer.ts` to
 * stay under the ADR-0024 line budget.
 *
 * Installs: `toString`, `equals`, `write`, `swap16/32/64`, `compare` (instance).
 *
 * Methods are written against `Uint8Array` (the only typed surface they need)
 * and assigned to the passed `BufferClass.prototype`. The class-level
 * signatures live in `buffer.ts` (using `declare`) so this file does not need
 * a type-back import — avoiding a circular dep madge would flag.
 */

import { type Encoding, compareSlices, decode, encode } from './buffer-codec.ts';

// Loosely typed constructor — we only need to reach `.prototype`. Keeping
// this opaque (no `import type { Buffer }`) keeps the dependency one-way.
type BufferLikeCtor = new (...args: unknown[]) => Uint8Array;

function bufferToString(
  this: Uint8Array,
  encoding: Encoding = 'utf8',
  start = 0,
  end: number = this.length,
): string {
  return decode(this.subarray(start, end), encoding);
}

function bufferEquals(this: Uint8Array, other: Uint8Array): boolean {
  if (this.length !== other.length) return false;
  for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
  return true;
}

function bufferWrite(
  this: Uint8Array,
  s: string,
  offsetOrEncoding?: number | Encoding,
  lengthOrEncoding?: number | Encoding,
  encodingArg?: Encoding,
): number {
  // Node overloads: write(s) / write(s, encoding) / write(s, offset, encoding)
  // / write(s, offset, length, encoding). Resolve to (offset, length, encoding).
  let offset: number;
  let length: number | undefined;
  let encoding: Encoding;

  if (typeof offsetOrEncoding === 'string') {
    offset = 0;
    length = undefined;
    encoding = offsetOrEncoding;
  } else {
    offset = offsetOrEncoding ?? 0;
    if (typeof lengthOrEncoding === 'string') {
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
}

function bufferSwap16(this: Uint8Array): Uint8Array {
  if (this.length % 2 !== 0) throw new RangeError('Buffer size must be a multiple of 16-bits');
  for (let i = 0; i < this.length; i += 2) {
    const a = this[i] ?? 0;
    this[i] = this[i + 1] ?? 0;
    this[i + 1] = a;
  }
  return this;
}

function bufferSwap32(this: Uint8Array): Uint8Array {
  if (this.length % 4 !== 0) throw new RangeError('Buffer size must be a multiple of 32-bits');
  for (let i = 0; i < this.length; i += 4) {
    const a = this[i] ?? 0;
    const b = this[i + 1] ?? 0;
    this[i] = this[i + 3] ?? 0;
    this[i + 1] = this[i + 2] ?? 0;
    this[i + 2] = b;
    this[i + 3] = a;
  }
  return this;
}

function bufferSwap64(this: Uint8Array): Uint8Array {
  if (this.length % 8 !== 0) throw new RangeError('Buffer size must be a multiple of 64-bits');
  for (let i = 0; i < this.length; i += 8) {
    for (let j = 0; j < 4; j++) {
      const a = this[i + j] ?? 0;
      this[i + j] = this[i + 7 - j] ?? 0;
      this[i + 7 - j] = a;
    }
  }
  return this;
}

function bufferCompare(
  this: Uint8Array,
  other: Uint8Array,
  targetStart = 0,
  targetEnd: number = other.length,
  sourceStart = 0,
  sourceEnd: number = this.length,
): -1 | 0 | 1 {
  return compareSlices(
    this.subarray(sourceStart, sourceEnd),
    other.subarray(targetStart, targetEnd),
  );
}

export function installCoreMethods(BufferClass: BufferLikeCtor): void {
  const p = BufferClass.prototype as Record<string, unknown>;
  p.toString = bufferToString;
  p.equals = bufferEquals;
  p.write = bufferWrite;
  p.swap16 = bufferSwap16;
  p.swap32 = bufferSwap32;
  p.swap64 = bufferSwap64;
  p.compare = bufferCompare;
}
