/**
 * Prototype methods for `Buffer` (ADR-0030).
 *
 * Three installers each register a group of methods onto `BufferClass.prototype`:
 *   - `installCoreMethods` — `toString`, `equals`, `write`, `swap16/32/64`, `compare`.
 *   - `installIntMethods` — integer / BigInt readers + writers.
 *   - `installExtraMethods` — Float / Double readers + writers,
 *     `indexOf` / `lastIndexOf` / `includes`, `fill`, `copy`.
 *
 * Methods are typed against `Uint8Array`; class-level signatures live in `buffer.ts`
 * (via `declare`) so this file needs no type-back import — avoids a circular dep madge would flag.
 */

import { type Encoding, compareSlices, decode, encode } from './buffer-codec.ts';

// Opaque ctor (no `import type { Buffer }`) keeps the dependency one-way.
type BufferLikeCtor = new (...args: unknown[]) => Uint8Array;

// Per-receiver cached full-range DataView. Each read/writeUInt* call reused a
// fresh `new DataView(buffer, byteOffset+offset, N)` before; that ctor is the
// hot cost. A full-range DataView built once per Buffer (lazily) lets the
// accessors pass `offset` straight to get/set instead. OOB is still a throw:
// `dv.getUint32(offset)` past bounds throws RangeError (no byte-math fallback
// that would return garbage). Keyed per receiver (WeakMap) so subarray/clone —
// each a NEW Uint8Array with its own .buffer — gets its own view on miss; the
// `dv.buffer !== u8.buffer` guard rebuilds if a receiver's backing buffer ever
// changes (detach/transfer).
const dvCache = new WeakMap<Uint8Array, DataView>();

function dvFor(u8: Uint8Array): DataView {
  let dv = dvCache.get(u8);
  if (dv === undefined || dv.buffer !== u8.buffer) {
    dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    dvCache.set(u8, dv);
  }
  return dv;
}

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
  // Node overloads write(s[, offset][, length][, encoding]) → (offset, length, encoding).
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

export function installIntMethods(BufferClass: BufferLikeCtor): void {
  const p = BufferClass.prototype as Record<string, unknown>;

  p.readUInt8 = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getUint8(offset);
  };
  p.readUInt16BE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getUint16(offset, false);
  };
  p.readUInt16LE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getUint16(offset, true);
  };
  p.readUInt32BE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getUint32(offset, false);
  };
  p.readUInt32LE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getUint32(offset, true);
  };
  p.readInt8 = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getInt8(offset);
  };
  p.readInt16BE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getInt16(offset, false);
  };
  p.readInt16LE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getInt16(offset, true);
  };
  p.readInt32BE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getInt32(offset, false);
  };
  p.readInt32LE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getInt32(offset, true);
  };
  p.readBigUInt64BE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getBigUint64(offset, false);
  };
  p.readBigUInt64LE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getBigUint64(offset, true);
  };
  p.readBigInt64BE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getBigInt64(offset, false);
  };
  p.readBigInt64LE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getBigInt64(offset, true);
  };

  // Writers return the post-write offset, matching Node.
  p.writeUInt8 = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setUint8(offset, value);
    return offset + 1;
  };
  p.writeUInt16BE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setUint16(offset, value, false);
    return offset + 2;
  };
  p.writeUInt16LE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setUint16(offset, value, true);
    return offset + 2;
  };
  p.writeUInt32BE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setUint32(offset, value, false);
    return offset + 4;
  };
  p.writeUInt32LE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setUint32(offset, value, true);
    return offset + 4;
  };
  p.writeInt8 = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setInt8(offset, value);
    return offset + 1;
  };
  p.writeInt16BE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setInt16(offset, value, false);
    return offset + 2;
  };
  p.writeInt16LE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setInt16(offset, value, true);
    return offset + 2;
  };
  p.writeInt32BE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setInt32(offset, value, false);
    return offset + 4;
  };
  p.writeInt32LE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setInt32(offset, value, true);
    return offset + 4;
  };
  p.writeBigUInt64BE = function (this: Uint8Array, value: bigint, offset = 0) {
    dvFor(this).setBigUint64(offset, value, false);
    return offset + 8;
  };
  p.writeBigUInt64LE = function (this: Uint8Array, value: bigint, offset = 0) {
    dvFor(this).setBigUint64(offset, value, true);
    return offset + 8;
  };
  p.writeBigInt64BE = function (this: Uint8Array, value: bigint, offset = 0) {
    dvFor(this).setBigInt64(offset, value, false);
    return offset + 8;
  };
  p.writeBigInt64LE = function (this: Uint8Array, value: bigint, offset = 0) {
    dvFor(this).setBigInt64(offset, value, true);
    return offset + 8;
  };

  // Variable-width (1–6 byte, ≤48-bit safe-integer) integer accessors. Node's
  // `installIntMethods` fixed-width set only covers 8/16/32; these read/write an
  // arbitrary byte length LE or BE, sign-extending the signed forms. Byte loop
  // over `dvFor` (same cached full-range DataView as the fixed-width accessors).
  const assertByteLength = (byteLength: number): void => {
    if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > 6) {
      throw new RangeError(
        `The value of "byteLength" is out of range. It must be >= 1 && <= 6. Received ${byteLength}`,
      );
    }
  };
  const readUInt = (u8: Uint8Array, offset: number, byteLength: number, le: boolean): number => {
    assertByteLength(byteLength);
    const dv = dvFor(u8);
    let val = 0;
    let mul = 1;
    if (le) {
      for (let i = 0; i < byteLength; i++) {
        val += dv.getUint8(offset + i) * mul;
        mul *= 0x100;
      }
    } else {
      for (let i = byteLength - 1; i >= 0; i--) {
        val += dv.getUint8(offset + i) * mul;
        mul *= 0x100;
      }
    }
    return val;
  };
  const readInt = (u8: Uint8Array, offset: number, byteLength: number, le: boolean): number => {
    const val = readUInt(u8, offset, byteLength, le);
    const sub = 0x100 ** byteLength;
    return val >= sub / 2 ? val - sub : val;
  };
  const writeInt = (
    u8: Uint8Array,
    value: number,
    offset: number,
    byteLength: number,
    le: boolean,
  ): number => {
    assertByteLength(byteLength);
    const dv = dvFor(u8);
    let v = value;
    if (le) {
      for (let i = 0; i < byteLength; i++) {
        dv.setUint8(offset + i, v & 0xff);
        v = Math.floor(v / 0x100);
      }
    } else {
      for (let i = byteLength - 1; i >= 0; i--) {
        dv.setUint8(offset + i, v & 0xff);
        v = Math.floor(v / 0x100);
      }
    }
    return offset + byteLength;
  };

  p.readUIntLE = function (this: Uint8Array, offset = 0, byteLength = 0) {
    return readUInt(this, offset, byteLength, true);
  };
  p.readUIntBE = function (this: Uint8Array, offset = 0, byteLength = 0) {
    return readUInt(this, offset, byteLength, false);
  };
  p.readIntLE = function (this: Uint8Array, offset = 0, byteLength = 0) {
    return readInt(this, offset, byteLength, true);
  };
  p.readIntBE = function (this: Uint8Array, offset = 0, byteLength = 0) {
    return readInt(this, offset, byteLength, false);
  };
  // Signed/unsigned writers share the byte loop: `& 0xff` + `Math.floor(v/256)`
  // already two's-complements a negative value (matches Node's writeIntLE/BE).
  p.writeUIntLE = function (this: Uint8Array, value: number, offset = 0, byteLength = 0) {
    return writeInt(this, value, offset, byteLength, true);
  };
  p.writeUIntBE = function (this: Uint8Array, value: number, offset = 0, byteLength = 0) {
    return writeInt(this, value, offset, byteLength, false);
  };
  p.writeIntLE = function (this: Uint8Array, value: number, offset = 0, byteLength = 0) {
    return writeInt(this, value, offset, byteLength, true);
  };
  p.writeIntBE = function (this: Uint8Array, value: number, offset = 0, byteLength = 0) {
    return writeInt(this, value, offset, byteLength, false);
  };

  // `buf.toJSON()` — the `{ type: 'Buffer', data: [...] }` round-trip shape
  // `JSON.stringify(buf)` emits and `Buffer.from(json.data)` reverses.
  p.toJSON = function (this: Uint8Array) {
    return { type: 'Buffer', data: Array.from(this) };
  };
}

/** Normalise an `indexOf`/`lastIndexOf` value to a searchable byte sequence. */
function asBytes(value: number | string | Uint8Array, encoding: Encoding): Uint8Array {
  if (typeof value === 'number') {
    // Node 22: a single integer needle wraps into 0-255 (incl. negative/out-of-range).
    const b = ((value | 0) + 256) & 0xff;
    const out = new Uint8Array(1);
    out[0] = b;
    return out;
  }
  if (typeof value === 'string') return encode(value, encoding);
  return value;
}

function findIndex(haystack: Uint8Array, needle: Uint8Array, fromIndex: number): number {
  if (needle.length === 0) return fromIndex >= haystack.length ? haystack.length : fromIndex;
  const start = fromIndex < 0 ? Math.max(0, haystack.length + fromIndex) : fromIndex;
  if (start > haystack.length - needle.length) return -1;
  outer: for (let i = start; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function findLastIndex(haystack: Uint8Array, needle: Uint8Array, fromIndex: number): number {
  if (needle.length === 0) return fromIndex >= 0 ? fromIndex : -1;
  // Node-style `fromIndex`: highest start position for the match (default = length - needle.length).
  let start = fromIndex < 0 ? Math.max(0, haystack.length + fromIndex) : fromIndex;
  const max = haystack.length - needle.length;
  if (start > max) start = max;
  outer: for (let i = start; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function installExtraMethods(BufferClass: BufferLikeCtor): void {
  const p = BufferClass.prototype as Record<string, unknown>;

  p.readFloatBE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getFloat32(offset, false);
  };
  p.readFloatLE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getFloat32(offset, true);
  };
  p.readDoubleBE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getFloat64(offset, false);
  };
  p.readDoubleLE = function (this: Uint8Array, offset = 0) {
    return dvFor(this).getFloat64(offset, true);
  };

  // Writers return the post-write offset, matching Node.
  p.writeFloatBE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setFloat32(offset, value, false);
    return offset + 4;
  };
  p.writeFloatLE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setFloat32(offset, value, true);
    return offset + 4;
  };
  p.writeDoubleBE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setFloat64(offset, value, false);
    return offset + 8;
  };
  p.writeDoubleLE = function (this: Uint8Array, value: number, offset = 0) {
    dvFor(this).setFloat64(offset, value, true);
    return offset + 8;
  };

  p.indexOf = function (
    this: Uint8Array,
    value: number | string | Uint8Array,
    byteOffsetOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ) {
    let from: number;
    let enc: Encoding;
    if (typeof byteOffsetOrEncoding === 'string') {
      from = 0;
      enc = byteOffsetOrEncoding;
    } else {
      from = byteOffsetOrEncoding ?? 0;
      enc = encoding ?? 'utf8';
    }
    return findIndex(this, asBytes(value, enc), from);
  };

  p.lastIndexOf = function (
    this: Uint8Array,
    value: number | string | Uint8Array,
    byteOffsetOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ) {
    let from: number;
    let enc: Encoding;
    if (typeof byteOffsetOrEncoding === 'string') {
      from = this.length;
      enc = byteOffsetOrEncoding;
    } else {
      from = byteOffsetOrEncoding ?? this.length;
      enc = encoding ?? 'utf8';
    }
    return findLastIndex(this, asBytes(value, enc), from);
  };

  p.includes = function (
    this: Uint8Array,
    value: number | string | Uint8Array,
    byteOffsetOrEncoding?: number | Encoding,
    encoding?: Encoding,
  ) {
    let from: number;
    let enc: Encoding;
    if (typeof byteOffsetOrEncoding === 'string') {
      from = 0;
      enc = byteOffsetOrEncoding;
    } else {
      from = byteOffsetOrEncoding ?? 0;
      enc = encoding ?? 'utf8';
    }
    return findIndex(this, asBytes(value, enc), from) !== -1;
  };

  // Overrides `Uint8Array.prototype.fill` to also accept strings / Uint8Array (Node semantics).
  p.fill = function (
    this: Uint8Array,
    value: number | string | Uint8Array,
    offsetOrEncoding?: number | Encoding,
    endOrEncoding?: number | Encoding,
    encodingArg?: Encoding,
  ): Uint8Array {
    let offset: number;
    let end: number;
    let enc: Encoding;
    if (typeof offsetOrEncoding === 'string') {
      offset = 0;
      end = this.length;
      enc = offsetOrEncoding;
    } else {
      offset = offsetOrEncoding ?? 0;
      if (typeof endOrEncoding === 'string') {
        end = this.length;
        enc = endOrEncoding;
      } else {
        end = endOrEncoding ?? this.length;
        enc = encodingArg ?? 'utf8';
      }
    }
    if (offset < 0 || end > this.length || offset > end) {
      throw new RangeError('Out of range index');
    }
    if (typeof value === 'number') {
      // Call Uint8Array.prototype.fill directly to avoid recursing into this override.
      Uint8Array.prototype.fill.call(this, value & 0xff, offset, end);
      return this;
    }
    const bytes = typeof value === 'string' ? encode(value, enc) : value;
    if (bytes.length === 0) {
      // Node throws when string fill encodes to zero bytes.
      throw new TypeError(`The argument 'value' is invalid. Received '${String(value)}'`);
    }
    let pos = offset;
    while (pos < end) {
      const take = Math.min(bytes.length, end - pos);
      this.set(bytes.subarray(0, take), pos);
      pos += take;
    }
    return this;
  };

  p.copy = function (
    this: Uint8Array,
    target: Uint8Array,
    targetStart = 0,
    sourceStart = 0,
    sourceEnd: number = this.length,
  ) {
    if (sourceEnd <= sourceStart) return 0;
    if (targetStart >= target.length) return 0;
    const srcEnd = Math.min(sourceEnd, this.length);
    const srcLen = srcEnd - sourceStart;
    const tgtAvail = target.length - targetStart;
    const n = Math.min(srcLen, tgtAvail);
    if (n <= 0) return 0;
    target.set(this.subarray(sourceStart, sourceStart + n), targetStart);
    return n;
  };
}
