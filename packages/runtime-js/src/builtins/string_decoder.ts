/**
 * `node:string_decoder`: Node v24 `lib/string_decoder.js` (wrapper, verbatim shape) over a port of
 * `src/string_decoder.cc` `DecodeData`/`FlushData` (the native state is the same 7-byte buffer:
 * 4 incomplete-character bytes, missing, buffered, encoding). Strings come from the Buffer codec.
 *
 * Names: `normalizeEncoding` only — v24.16.0's wrapper has no `Buffer.isEncoding` fallback (older
 * Node had one); a patched `isEncoding` still gives ERR_UNKNOWN_ENCODING (parity row).
 *
 * A callable constructor, not a class: iconv-lite's `InternalDecoder` runs
 * `StringDecoder.call(this, enc)` (body-parser's body decode).
 */
import {
  Buffer,
  type CanonicalEncoding,
  bytesToString,
  normalizeEncoding,
  unknownEncodingError,
} from '@riftydev/io';
import { invalidArgType } from '../internal/node-received.ts';
import { bytesOf, isView } from './view-bytes.ts';

const kIncompleteCharactersStart = 0;
const kIncompleteCharactersEnd = 4;
const kMissingBytes = 4;
const kBufferedBytes = 5;
const kEncodingField = 6;
const kSize = 7;
// `internalBinding('string_decoder').encodings`, the `kEncodingField` values.
const ENCODINGS = ['ascii', 'utf8', 'base64', 'utf16le', 'latin1', 'hex', 'buffer', 'base64url'];
// `encodingsMap`: a plain lookup, no prototype methods a guest can replace.
const ENCODING_FIELD: Record<string, number> = {
  __proto__: null,
  ascii: 0,
  utf8: 1,
  base64: 2,
  utf16le: 3,
  latin1: 4,
  hex: 5,
  buffer: 6,
  base64url: 7,
} as unknown as Record<string, number>;
const UTF8 = 1;
const BASE64 = 2;
const UCS2 = 3;
const BASE64URL = 7;

const kNativeDecoder: unique symbol = Symbol('kNativeDecoder');

export interface StringDecoder {
  encoding: CanonicalEncoding;
  write(buf: string | ArrayBufferView): string;
  end(buf?: string | ArrayBufferView): string;
  text(buf: Uint8Array, offset: number): string;
  readonly lastChar: Uint8Array;
  readonly lastNeed: number;
  readonly lastTotal: number;
}

interface DecoderThis extends StringDecoder {
  [kNativeDecoder]: Uint8Array;
}

// Load-time intrinsics (a view's bytes: `bytesOf`, `./view-bytes.ts`), never members a program patches.
const TypedArrayProto = Object.getPrototypeOf(Uint8Array.prototype) as object;
const taByteLength = Object.getOwnPropertyDescriptor(TypedArrayProto, 'byteLength')?.get as (
  this: unknown,
) => unknown;
const { apply } = Reflect;
const read = (get: (this: unknown) => unknown, view: unknown): unknown => apply(get, view, []);
const taSubarray = (TypedArrayProto as { subarray: (s: number, e: number) => Uint8Array }).subarray;

const makeString = (bytes: Uint8Array, enc: number): string =>
  bytesToString(bytes, ENCODINGS[enc] as string);

/** Copy `n` bytes of `from` at `start` into `state` at `at` (at most 4). */
function copyInto(state: Uint8Array, at: number, from: Uint8Array, start: number, n: number): void {
  for (let i = 0; i < n; i++) state[at + i] = from[start + i] as number;
}

/** `StringDecoder::DecodeData`. */
function decode(state: Uint8Array, view: ArrayBufferView): string {
  const data = bytesOf(view);
  const enc = state[kEncodingField] as number;
  if (enc !== UTF8 && enc !== UCS2 && enc !== BASE64 && enc !== BASE64URL)
    return makeString(data, enc);
  let missing = state[kMissingBytes] as number;
  let buffered = state[kBufferedBytes] as number;
  let off = 0;
  let nread = read(taByteLength, data) as number;
  let prepend: string | undefined;
  if (missing > 0) {
    if (enc === UTF8) {
      // A non-continuation byte ends the incomplete character early; it starts a new one.
      for (let i = 0; i < nread && i < missing; ++i) {
        if (((data[i] as number) & 0xc0) !== 0x80) {
          missing = 0;
          copyInto(state, buffered, data, 0, i);
          buffered += i;
          off = i;
          nread -= i;
          break;
        }
      }
    }
    const found = nread < missing ? nread : missing;
    copyInto(state, buffered, data, off, found);
    off += found;
    nread -= found;
    missing -= found;
    buffered += found;
    if (missing === 0) {
      prepend = makeString(bytesOf(state, 0, buffered), enc);
      buffered = 0;
    }
  }
  let body = '';
  if (nread > 0) {
    const last = data[off + nread - 1] as number;
    if (enc === UTF8) {
      if (last & 0x80) {
        // Walk back to the lead byte of the last character; keep it if incomplete.
        for (let i = nread - 1; ; --i) {
          buffered++;
          const b = data[off + i] as number;
          if ((b & 0xc0) === 0x80) {
            if (buffered >= 4 || i === 0) {
              buffered = 0;
              break;
            }
          } else {
            if ((b & 0xe0) === 0xc0) missing = 2;
            else if ((b & 0xf0) === 0xe0) missing = 3;
            else if ((b & 0xf8) === 0xf0) missing = 4;
            else {
              buffered = 0;
              break;
            }
            if (buffered >= missing) {
              missing = 0;
              buffered = 0;
            }
            missing -= buffered;
            break;
          }
        }
      }
    } else if (enc === UCS2) {
      if (nread % 2 === 1) {
        buffered = 1;
        missing = 1;
      } else if ((last & 0xfc) === 0xd8) {
        // High surrogate: wait for its pair.
        buffered = 2;
        missing = 2;
      }
    } else {
      buffered = nread % 3;
      if (buffered > 0) missing = 3 - buffered;
    }
    if (buffered > 0) {
      nread -= buffered;
      copyInto(state, 0, data, off + nread, buffered);
    }
    if (nread > 0) body = makeString(bytesOf(data, off, nread), enc);
  }
  state[kMissingBytes] = missing;
  state[kBufferedBytes] = buffered;
  return prepend === undefined ? body : prepend + body;
}

/** `StringDecoder::FlushData`. */
function flush(state: Uint8Array): string {
  if (state[kEncodingField] === UCS2 && (state[kBufferedBytes] as number) % 2 === 1) {
    // A lone trailing byte is dropped.
    state[kMissingBytes] = (state[kMissingBytes] as number) - 1;
    state[kBufferedBytes] = (state[kBufferedBytes] as number) - 1;
  }
  if (state[kBufferedBytes] === 0) return '';
  const ret = makeString(
    bytesOf(state, 0, state[kBufferedBytes] as number),
    state[kEncodingField] as number,
  );
  state[kMissingBytes] = 0;
  state[kBufferedBytes] = 0;
  return ret;
}

function invalidThis(): TypeError {
  const error = new TypeError('Value of "this" must be of type StringDecoder') as TypeError & {
    code: string;
  };
  error.code = 'ERR_INVALID_THIS';
  return error;
}

export function StringDecoder(this: DecoderThis, encoding?: unknown): void {
  this.encoding = normalizeEncoding(encoding) as CanonicalEncoding;
  if (this.encoding === undefined) throw unknownEncodingError(encoding);
  this[kNativeDecoder] = Buffer.alloc(kSize);
  this[kNativeDecoder][kEncodingField] = ENCODING_FIELD[this.encoding] as number;
}

StringDecoder.prototype.write = function write(this: DecoderThis, buf: unknown): string {
  if (typeof buf === 'string') return buf;
  if (!isView(buf)) {
    throw invalidArgType('"buf" argument', 'an instance of Buffer, TypedArray, or DataView', buf);
  }
  if (!this[kNativeDecoder]) throw invalidThis();
  return decode(this[kNativeDecoder], buf);
};

StringDecoder.prototype.end = function end(this: DecoderThis, buf?: unknown): string {
  const ret = buf === undefined ? '' : this.write(buf as ArrayBufferView);
  if ((this[kNativeDecoder][kBufferedBytes] as number) > 0)
    return ret + flush(this[kNativeDecoder]);
  return ret;
};

StringDecoder.prototype.text = function text(
  this: DecoderThis,
  buf: Uint8Array,
  offset: number,
): string {
  this[kNativeDecoder][kMissingBytes] = 0;
  this[kNativeDecoder][kBufferedBytes] = 0;
  return this.write(buf.slice(offset));
};

Object.defineProperties(StringDecoder.prototype, {
  lastChar: {
    configurable: true,
    enumerable: true,
    get(this: DecoderThis) {
      return apply(taSubarray, this[kNativeDecoder], [
        kIncompleteCharactersStart,
        kIncompleteCharactersEnd,
      ]);
    },
  },
  lastNeed: {
    configurable: true,
    enumerable: true,
    get(this: DecoderThis) {
      return this[kNativeDecoder][kMissingBytes];
    },
  },
  lastTotal: {
    configurable: true,
    enumerable: true,
    get(this: DecoderThis) {
      return (
        (this[kNativeDecoder][kBufferedBytes] as number) +
        (this[kNativeDecoder][kMissingBytes] as number)
      );
    },
  },
});

const stringDecoderModule = { StringDecoder };
export default stringDecoderModule;
