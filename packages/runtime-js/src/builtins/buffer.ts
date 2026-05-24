/**
 * Node-compatible `node:buffer` — minimal Buffer implementation.
 *
 * Node's Buffer extends Uint8Array. We use a static factory pattern (`Buffer.from`,
 * `Buffer.alloc`) and return Uint8Array instances tagged with Buffer-style helpers
 * via prototype patching.
 *
 * What we cover: from(string/array/ArrayBuffer/Uint8Array), alloc, concat,
 * byteLength, toString('utf8'|'hex'|'base64'), isBuffer, equals, write,
 * read/write{Int,UInt}{8,16,32}{BE,LE}, read/write{Big}{Int,UInt}64{BE,LE},
 * swap{16,32,64}, compare (instance + static).
 *
 * Not covered yet (add when a real package needs them):
 * read/writeFloat{BE,LE}, read/writeDouble{BE,LE}, indexOf/includes, fill,
 * copy, copyWithin overloads.
 */

const TAG = Symbol.for('nodejs.Buffer');

export type Encoding =
  | 'utf8'
  | 'utf-8'
  | 'hex'
  | 'base64'
  | 'base64url'
  | 'ascii'
  | 'latin1'
  | 'binary';

/**
 * Buffer return type. A `Uint8Array` with Node-shaped helpers patched onto
 * each instance via `Object.defineProperty`. We declare the methods on the
 * type so callers see them, and use a plain Uint8Array assignability so
 * `Buffer.from(...)` flows into any API expecting a Uint8Array.
 */
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
export type BufferLike = Buffer;

function viewOf(u8: Uint8Array, offset: number, byteLen: number): DataView {
  return new DataView(u8.buffer, u8.byteOffset + offset, byteLen);
}

function defineMethod(u8: Uint8Array, name: string, value: (...args: never[]) => unknown): void {
  Object.defineProperty(u8, name, { configurable: true, writable: true, value });
}

function tag(u8: Uint8Array): Buffer {
  (u8 as unknown as { [k: symbol]: boolean })[TAG] = true;
  // Patch via defineProperty so we don't fight TS's prototype variance rules.
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

function compareSlices(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}

function encode(s: string, enc: Encoding): Uint8Array {
  if (enc === 'utf8' || enc === 'utf-8') return new TextEncoder().encode(s);
  if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  if (enc === 'hex') {
    const len = s.length / 2;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  if (enc === 'base64' || enc === 'base64url') {
    const normalised = enc === 'base64url' ? s.replace(/-/g, '+').replace(/_/g, '/') : s;
    const bin = atob(normalised);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  throw new Error(`Unsupported encoding: ${enc}`);
}

function decode(view: Uint8Array, enc: Encoding): string {
  if (enc === 'utf8' || enc === 'utf-8') return new TextDecoder('utf-8').decode(view);
  if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') {
    let s = '';
    for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i] ?? 0);
    return s;
  }
  if (enc === 'hex') {
    let out = '';
    for (let i = 0; i < view.length; i++) out += (view[i] ?? 0).toString(16).padStart(2, '0');
    return out;
  }
  if (enc === 'base64' || enc === 'base64url') {
    let bin = '';
    for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i] ?? 0);
    const b64 = btoa(bin);
    return enc === 'base64url'
      ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      : b64;
  }
  throw new Error(`Unsupported encoding: ${enc}`);
}

function alloc(size: number, fill?: number | string, _encoding?: Encoding): Buffer {
  const u8 = new Uint8Array(size);
  if (fill !== undefined) {
    if (typeof fill === 'number') u8.fill(fill);
    else u8.set(encode(fill, 'utf8'));
  }
  return tag(u8);
}

function allocUnsafe(size: number): Buffer {
  return tag(new Uint8Array(size));
}

function from(
  value: string | ArrayBuffer | ArrayLike<number> | Uint8Array,
  encodingOrOffset?: Encoding | number,
  length?: number,
): Buffer {
  if (typeof value === 'string') {
    return tag(encode(value, (encodingOrOffset as Encoding) ?? 'utf8'));
  }
  if (value instanceof Uint8Array) {
    return tag(new Uint8Array(value));
  }
  if (value instanceof ArrayBuffer) {
    const offset = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
    return tag(new Uint8Array(value, offset, length));
  }
  return tag(new Uint8Array(value));
}

function concat(list: readonly Uint8Array[], totalLength?: number): Buffer {
  let len = totalLength;
  if (len === undefined) {
    len = 0;
    for (const a of list) len += a.length;
  }
  const out = new Uint8Array(len);
  let offset = 0;
  for (const a of list) {
    const remaining = len - offset;
    const take = a.subarray(0, Math.min(a.length, remaining));
    out.set(take, offset);
    offset += take.length;
    if (offset >= len) break;
  }
  return tag(out);
}

function byteLength(s: string, encoding: Encoding = 'utf8'): number {
  return encode(s, encoding).length;
}

function isBuffer(v: unknown): boolean {
  return Boolean(v && (v as { [k: symbol]: unknown })[TAG]);
}

function compare(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
  return compareSlices(a, b);
}

export const Buffer = {
  alloc,
  allocUnsafe,
  from,
  concat,
  byteLength,
  isBuffer,
  compare,
} as const;
export default { Buffer };
