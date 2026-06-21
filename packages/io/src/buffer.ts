/**
 * Node-compatible `node:buffer` — `Buffer` is a real subclass of `Uint8Array`
 * (ADR-0030), so `subarray()` / `slice()` / structured-clone preserve the
 * Buffer brand via `Symbol.species`, and `instanceof Uint8Array` is `true`.
 *
 * Per-instance method impls are installed onto the prototype by
 * `installCoreMethods` / `installIntMethods` / `installExtraMethods` from
 * `buffer-prototype.ts`. Their type signatures live here (`declare` on the
 * class body) so the installers need not import the `Buffer` type back —
 * avoiding a runtime circular dep that `pnpm check:arch` would flag.
 */

import { type Encoding, compareSlices, encode } from './buffer-codec.ts';
import { installCoreMethods, installExtraMethods, installIntMethods } from './buffer-prototype.ts';

export type { Encoding };

export class Buffer extends Uint8Array {
  /**
   * Ensure `subarray()` / `slice()` and similar typed-array operations that
   * use `Symbol.species` return a `Buffer`, not a plain `Uint8Array`.
   */
  static get [Symbol.species](): typeof Uint8Array {
    return Buffer as unknown as typeof Uint8Array;
  }

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
  declare readUIntLE: (offset: number, byteLength: number) => number;
  declare readUIntBE: (offset: number, byteLength: number) => number;
  declare readIntLE: (offset: number, byteLength: number) => number;
  declare readIntBE: (offset: number, byteLength: number) => number;
  declare writeUIntLE: (value: number, offset: number, byteLength: number) => number;
  declare writeUIntBE: (value: number, offset: number, byteLength: number) => number;
  declare writeIntLE: (value: number, offset: number, byteLength: number) => number;
  declare writeIntBE: (value: number, offset: number, byteLength: number) => number;
  declare toJSON: () => { type: 'Buffer'; data: number[] };
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
  // `declare` shadows Uint8Array's `fill` with the wider Node form.
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

  /**
   * Node's `Buffer.allocUnsafeSlow` — never drawn from the shared pool. We
   * don't pool, so it's identical to {@link allocUnsafe}. Present so
   * `safe-buffer` detects a "real" Buffer: it gates on
   * `from && alloc && allocUnsafe && allocUnsafeSlow` before re-exporting the
   * full surface (incl. {@link isBuffer}), which express's `res.send` needs.
   */
  static allocUnsafeSlow(size: number): Buffer {
    return new Buffer(size);
  }

  // Explicit overloads keep the static side assignable to the base
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

  private static readonly ENCODINGS: ReadonlySet<string> = new Set([
    'utf8',
    'utf-8',
    'utf16le',
    'utf-16le',
    'ucs2',
    'ucs-2',
    'hex',
    'base64',
    'base64url',
    'ascii',
    'latin1',
    'binary',
  ]);

  /** Node's `Buffer.isEncoding` — case-insensitive check of a known encoding. */
  static isEncoding(encoding: unknown): boolean {
    return typeof encoding === 'string' && Buffer.ENCODINGS.has(encoding.toLowerCase());
  }

  /**
   * Static comparator. Node's runtime honours only the first two args
   * (verified via parity-runner; `Buffer.compare.length === 2`), but its docs
   * leave room for range params and the instance method already supports them.
   * We widen the signature symmetrically — extras honoured via `subarray(...)`
   * — so a future Node adopting this surface forces no typing churn here.
   */
  static compare(
    a: Uint8Array,
    b: Uint8Array,
    targetStart = 0,
    targetEnd: number = b.length,
    sourceStart = 0,
    sourceEnd: number = a.length,
  ): -1 | 0 | 1 {
    return compareSlices(a.subarray(sourceStart, sourceEnd), b.subarray(targetStart, targetEnd));
  }

  /**
   * `Buffer.copyBytesFrom(view[, offset[, length]])` (v18.16) — copies a window
   * of a TypedArray's underlying bytes into a NEW Buffer (explicit copy, NOT the
   * aliasing `Buffer.from(arrayBuffer)`). `offset`/`length` are in the view's
   * ELEMENTS, so the byte window is `byteOffset + offset*BYTES_PER_ELEMENT`,
   * `length*BYTES_PER_ELEMENT` bytes.
   */
  static copyBytesFrom(
    view: ArrayBufferView & { BYTES_PER_ELEMENT?: number; length?: number },
    offset = 0,
    length?: number,
  ): Buffer {
    // Node requires a TypedArray and explicitly REJECTS a DataView (which is an
    // ArrayBufferView but has no BYTES_PER_ELEMENT) — match that, never silently
    // treat a DataView as 1 byte/element.
    if (!ArrayBuffer.isView(view) || view.BYTES_PER_ELEMENT === undefined) {
      const e = new TypeError('The "view" argument must be an instance of TypedArray.');
      (e as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
      throw e;
    }
    // Node validates offset/length with the generic integer validator (ERR_INVALID_ARG_TYPE
    // for a non-number, ERR_OUT_OF_RANGE for non-integer / out of [0, MAX_SAFE_INTEGER]) —
    // never silently coerce a string/float/NaN/negative through the Uint8Array ctor.
    const checkInt = (v: unknown, name: string): void => {
      if (typeof v !== 'number') {
        const e = new TypeError(
          `The "${name}" argument must be of type number. Received ${v === null ? 'null' : `type ${typeof v}`}`,
        );
        (e as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
        throw e;
      }
      const rng = (detail: string): RangeError => {
        const e = new RangeError(`The value of "${name}" is out of range. ${detail}`);
        (e as { code?: string }).code = 'ERR_OUT_OF_RANGE';
        return e;
      };
      if (!Number.isInteger(v)) throw rng(`It must be an integer. Received ${v}`);
      if (v < 0 || v > Number.MAX_SAFE_INTEGER) {
        throw rng(`It must be >= 0 && <= ${Number.MAX_SAFE_INTEGER}. Received ${v}`);
      }
    };
    checkInt(offset, 'offset');
    if (length !== undefined) checkInt(length, 'length');
    // Node CLAMPS the element window to the view's bounds (offset > count → empty;
    // length > remaining → truncated). Use subarray (which clamps) rather than a
    // hand-computed byte window that would throw "Invalid typed array length".
    const win = (
      view as unknown as { subarray(begin: number, end?: number): ArrayBufferView }
    ).subarray(offset, length === undefined ? undefined : offset + length);
    const src = new Uint8Array(win.buffer as ArrayBuffer, win.byteOffset, win.byteLength);
    const out = new Buffer(src.length);
    out.set(src);
    return out;
  }
}

// Installers take the class as an opaque constructor (no type-back imports)
// so check:arch sees no circular reference between this file and the helpers.
installCoreMethods(Buffer);
installIntMethods(Buffer);
installExtraMethods(Buffer);

export type BufferLike = Buffer;

// `node:buffer.INSPECT_MAX_BYTES` — the live truncation threshold the inspector
// (`runtime-js/repl/inspect.ts` `<Buffer …>` renderer) reads. Mutable so user
// code's `buffer.INSPECT_MAX_BYTES = N` actually changes truncation (Node
// parity); the `node:buffer` export is a getter/setter over this cell.
let inspectMaxBytes = 50;
export function getInspectMaxBytes(): number {
  return inspectMaxBytes;
}
export function setInspectMaxBytes(n: number): void {
  // Node validates the assignment: number-typed (ERR_INVALID_ARG_TYPE) and >= 0
  // (ERR_OUT_OF_RANGE) — never silently store a string/null/negative.
  if (typeof n !== 'number') {
    const e = new TypeError(
      `The "INSPECT_MAX_BYTES" argument must be of type number. Received ${n === null ? 'null' : `type ${typeof n}`}`,
    );
    (e as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
    throw e;
  }
  // `!(n >= 0)` rejects negatives AND NaN (Node's `>= 0` validator throws ERR_OUT_OF_RANGE
  // for NaN too — `n < 0` alone would silently store NaN).
  if (!(n >= 0)) {
    const e = new RangeError(
      `The value of "INSPECT_MAX_BYTES" is out of range. It must be >= 0. Received ${n}`,
    );
    (e as { code?: string }).code = 'ERR_OUT_OF_RANGE';
    throw e;
  }
  inspectMaxBytes = n;
}

/**
 * Coerce a Buffer / TypedArray / ArrayBuffer to a byte view (no copy). Node's
 * `isUtf8`/`isAscii` accept exactly those and REJECT a DataView (an ArrayBufferView
 * with no `BYTES_PER_ELEMENT`) with `ERR_INVALID_ARG_TYPE` — match that.
 */
function asByteView(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (
    ArrayBuffer.isView(input) &&
    (input as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT !== undefined
  ) {
    const v = input as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  const e = new TypeError(
    'The "input" argument must be an instance of ArrayBuffer, Buffer, or TypedArray.',
  );
  (e as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
  throw e;
}

/** `node:buffer.isUtf8` — true iff the bytes are well-formed UTF-8 (fatal decode round-trip). */
export function isUtf8(input: unknown): boolean {
  const bytes = asByteView(input);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** `node:buffer.isAscii` — true iff every byte is 7-bit ASCII (< 0x80). */
export function isAscii(input: unknown): boolean {
  const bytes = asByteView(input);
  for (let i = 0; i < bytes.length; i++) {
    if ((bytes[i] ?? 0) > 0x7f) return false;
  }
  return true;
}

export default { Buffer };
