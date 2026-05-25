/**
 * Additional Buffer prototype methods (ADR-0030). Split out of `buffer.ts` to
 * stay under the ADR-0024 line budget. Wires up:
 *
 *   - Float/Double readers + writers (DataView-backed).
 *   - `indexOf` / `lastIndexOf` / `includes` (byte int OR sub-buffer search).
 *   - `fill(value, offset?, end?, encoding?)` honoring Node's tile semantics.
 *   - `copy(target, targetStart?, sourceStart?, sourceEnd?)` (Uint8Array.set).
 *
 * No type-back import from `buffer.ts` — the class-level signatures are
 * declared there. This file only manipulates `BufferClass.prototype`.
 */

import { type Encoding, encode } from './buffer-codec.ts';

type BufferLikeCtor = new (...args: unknown[]) => Uint8Array;

function viewOf(u8: Uint8Array, offset: number, byteLen: number): DataView {
  return new DataView(u8.buffer, u8.byteOffset + offset, byteLen);
}

/** Normalise an `indexOf`/`lastIndexOf` value to a searchable byte sequence. */
function asBytes(value: number | string | Uint8Array, encoding: Encoding): Uint8Array {
  if (typeof value === 'number') {
    // Node coerces a single integer 0-255 to a one-byte needle. Negative or
    // out-of-range values wrap into 0-255 (matches Node 22 behaviour).
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
  // `fromIndex` is interpreted Node-style: the highest position the match may
  // start at. Default = haystack.length - needle.length.
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

  // ---- Float / Double readers ----
  p.readFloatBE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getFloat32(0, false);
  };
  p.readFloatLE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 4).getFloat32(0, true);
  };
  p.readDoubleBE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getFloat64(0, false);
  };
  p.readDoubleLE = function (this: Uint8Array, offset = 0) {
    return viewOf(this, offset, 8).getFloat64(0, true);
  };

  // ---- Float / Double writers (return post-write offset, matching Node) ----
  p.writeFloatBE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setFloat32(0, value, false);
    return offset + 4;
  };
  p.writeFloatLE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 4).setFloat32(0, value, true);
    return offset + 4;
  };
  p.writeDoubleBE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 8).setFloat64(0, value, false);
    return offset + 8;
  };
  p.writeDoubleLE = function (this: Uint8Array, value: number, offset = 0) {
    viewOf(this, offset, 8).setFloat64(0, value, true);
    return offset + 8;
  };

  // ---- indexOf / lastIndexOf / includes ----
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

  // ---- fill(value, offset?, end?, encoding?) ----
  // Overrides `Uint8Array.prototype.fill` to accept strings / Uint8Array per
  // Node semantics.
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
      // Use the Uint8Array prototype directly to avoid infinite recursion via
      // the overridden `fill` on Buffer.
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

  // ---- copy(target, targetStart?, sourceStart?, sourceEnd?) ----
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
