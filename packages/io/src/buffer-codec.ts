/**
 * Encode/decode helpers for the Buffer polyfill. Split out of `buffer.ts` to
 * keep that file under the ADR-0024 line budget.
 */

/**
 * An encoding argument: `@types/node`'s `BufferEncoding` names, plus any other string — the
 * runtime takes every spelling `normalizeEncoding` maps (`'UTF8'`) and throws on the rest.
 */
export type Encoding =
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'utf-16le'
  | 'ucs2'
  | 'ucs-2'
  | 'hex'
  | 'base64'
  | 'base64url'
  | 'ascii'
  | 'latin1'
  | 'binary'
  | (string & Record<never, never>);

/** The names Node's `normalizeEncoding` returns; every codec branch keys on one. */
export type CanonicalEncoding =
  | 'utf8'
  | 'utf16le'
  | 'latin1'
  | 'ascii'
  | 'base64'
  | 'base64url'
  | 'hex';

const toLower = (s: unknown): string => String.prototype.toLowerCase.call(s);

/**
 * Node v24 `normalizeEncoding` + `slowCases` (lib/internal/util.js), verbatim:
 * the one name table. `null`/`undefined`/`''` are utf8; unknown → `undefined`.
 * Buffer entry points differ only in how they treat `''` and non-strings
 * ({@link bufferEncoding}); `string_decoder` uses this one as Node does.
 */
export function normalizeEncoding(enc: unknown): CanonicalEncoding | undefined {
  if (enc == null || enc === 'utf8' || enc === 'utf-8') return 'utf8';
  let e = enc as string;
  switch (e.length) {
    case 4:
      if (e === 'UTF8') return 'utf8';
      if (e === 'ucs2' || e === 'UCS2') return 'utf16le';
      e = toLower(e);
      if (e === 'utf8') return 'utf8';
      if (e === 'ucs2') return 'utf16le';
      break;
    case 3:
      if (e === 'hex' || e === 'HEX' || toLower(e) === 'hex') return 'hex';
      break;
    case 5:
      if (e === 'ascii') return 'ascii';
      if (e === 'ucs-2') return 'utf16le';
      if (e === 'UTF-8') return 'utf8';
      if (e === 'ASCII') return 'ascii';
      if (e === 'UCS-2') return 'utf16le';
      e = toLower(e);
      if (e === 'utf-8') return 'utf8';
      if (e === 'ascii') return 'ascii';
      if (e === 'ucs-2') return 'utf16le';
      break;
    case 6:
      if (e === 'base64') return 'base64';
      if (e === 'latin1' || e === 'binary') return 'latin1';
      if (e === 'BASE64') return 'base64';
      if (e === 'LATIN1' || e === 'BINARY') return 'latin1';
      e = toLower(e);
      if (e === 'base64') return 'base64';
      if (e === 'latin1' || e === 'binary') return 'latin1';
      break;
    case 7:
      if (e === 'utf16le' || e === 'UTF16LE' || toLower(e) === 'utf16le') return 'utf16le';
      break;
    case 8:
      if (e === 'utf-16le' || e === 'UTF-16LE' || toLower(e) === 'utf-16le') return 'utf16le';
      break;
    case 9:
      if (e === 'base64url' || e === 'BASE64URL' || toLower(e) === 'base64url') return 'base64url';
      break;
    default:
      if (e === '') return 'utf8';
  }
  return undefined;
}

/**
 * Node buffer.js `getEncodingOps` name rule (`toString`, `write`, `from`,
 * `byteLength`, `indexOf`): the value is stringified, then looked up; `''` is
 * unknown here.
 */
export function bufferEncoding(enc: unknown): CanonicalEncoding | undefined {
  // biome-ignore lint/style/useTemplate: Node's `encoding += ''` (ToPrimitive, valueOf first).
  const s = (enc as string) + '';
  return s === '' ? undefined : normalizeEncoding(s);
}

/** Node's `ERR_UNKNOWN_ENCODING`. */
export function unknownEncodingError(enc: unknown): TypeError & { code: string } {
  const error = new TypeError(`Unknown encoding: ${String(enc)}`) as TypeError & { code: string };
  error.code = 'ERR_UNKNOWN_ENCODING';
  return error;
}

/** Node's `ERR_INVALID_ARG_TYPE` (`The "<name>" argument must be <expected>. Received …`). */
export function invalidArgType(name: string, expected: string, value: unknown): TypeError {
  let received: string;
  if (value == null) received = String(value);
  else if (typeof value === 'function') received = `function ${value.name}`;
  else if (typeof value === 'object') {
    received = `an instance of ${(value as { constructor?: { name?: string } }).constructor?.name}`;
  } else {
    const shown =
      typeof value === 'bigint' ? `${value}n` : Object.is(value, -0) ? '-0' : String(value);
    received = `type ${typeof value} (${shown.length > 28 ? `${shown.slice(0, 25)}...` : shown})`;
  }
  const error = new TypeError(
    `The "${name}" argument must be ${expected}. Received ${received}`,
  ) as TypeError & { code: string };
  error.code = 'ERR_INVALID_ARG_TYPE';
  return error;
}

/** {@link bufferEncoding} or throw `ERR_UNKNOWN_ENCODING`. */
export function resolveEncoding(enc: unknown): CanonicalEncoding {
  const canonical = bufferEncoding(enc);
  if (canonical === undefined) throw unknownEncodingError(enc);
  return canonical;
}

// Module-level singletons: one-shot utf8 encode/decode is stateless (no
// {stream:true}), so a shared instance is byte-identical and avoids per-call
// allocation. Decoder is non-fatal (bad bytes -> U+FFFD) and keeps a leading
// BOM like Node (WHATWG default strips it).
// Do NOT use these for the streaming {stream:true} decoder (cross-chunk state).
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

// Batch code units through String.fromCharCode.apply in slices of this size to
// avoid the O(n^2) per-char string concat, while staying under the engine
// apply arg-count ceiling (~65535 on V8/JSC).
const FROM_CHARCODE_CHUNK = 0x2000; // 8192

// Byte → digit value, -1 outside the alphabet. Node's decoders index by the
// character's low byte (`static_cast<uint8_t>`), so 'Ł' (U+0141) reads as 'A'.
const HEX_DIGIT = /* @__PURE__ */ digitTable('0123456789abcdef', 'ABCDEF', 10);
// nbytes' `unbase64`: one table for both alphabets.
const BASE64_DIGIT = /* @__PURE__ */ digitTable(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  '-_',
  62,
);

function digitTable(alphabet: string, extra: string, extraFrom: number): Int8Array {
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < alphabet.length; i++) t[alphabet.charCodeAt(i)] = i;
  for (let i = 0; i < extra.length; i++) t[extra.charCodeAt(i)] = extraFrom + i;
  return t;
}

/** nbytes `hex_decode`: pairs until the first bad one; an odd tail is dropped. */
function hexToBytes(s: string): Uint8Array {
  const len = s.length >>> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const hi = HEX_DIGIT[s.charCodeAt(i * 2) & 0xff] ?? -1;
    const lo = HEX_DIGIT[s.charCodeAt(i * 2 + 1) & 0xff] ?? -1;
    if ((hi | lo) < 0) return out.subarray(0, i);
    out[i] = (hi << 4) | lo;
  }
  return out;
}

/**
 * Node decodes base64 as WHATWG forgiving-base64 (simdutf) and, when that
 * rejects the input, with nbytes' lenient `Base64Decode`. Both give the same
 * bytes on input the first accepts, so `atob` is only the fast path.
 */
function base64ToBytes(s: string, url: boolean): Uint8Array {
  let bin: string;
  try {
    bin = atob(url ? s.replace(/[-_]/g, (c) => (c === '-' ? '+' : '/')) : s);
  } catch {
    return base64Lenient(s);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** nbytes `Base64Decode`: either alphabet, other characters skipped, '=' stops. */
function base64Lenient(s: string): Uint8Array {
  const out = new Uint8Array((s.length * 3) >>> 2);
  let k = 0;
  let acc = 0;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) & 0xff;
    const v = BASE64_DIGIT[c] ?? -1;
    if (v < 0) {
      if (c === 0x3d) break;
      continue;
    }
    acc = (acc << 6) | v;
    if (++n === 4) {
      out[k++] = acc >>> 16;
      out[k++] = (acc >>> 8) & 0xff;
      out[k++] = acc & 0xff;
      acc = 0;
      n = 0;
    }
  }
  if (n === 2) out[k++] = (acc >>> 4) & 0xff;
  else if (n === 3) {
    out[k++] = (acc >>> 10) & 0xff;
    out[k++] = (acc >>> 2) & 0xff;
  }
  return out.subarray(0, k);
}

/** Node's `byteLength` per encoding: base64/hex are its estimates, not decoded sizes. */
export function byteLengthOf(s: string, enc: CanonicalEncoding): number {
  switch (enc) {
    case 'utf16le':
      return s.length * 2;
    case 'latin1':
    case 'ascii':
      return s.length;
    case 'hex':
      return s.length >>> 1;
    case 'base64':
    case 'base64url': {
      let n = s.length;
      if (s.charCodeAt(n - 1) === 0x3d) n--;
      if (n > 1 && s.charCodeAt(n - 1) === 0x3d) n--;
      return (n * 3) >>> 2;
    }
    default:
      return UTF8_ENCODER.encode(s).length;
  }
}

/** Encode `s`; a non-canonical name resolves like Node's `getEncodingOps`. */
export function encode(s: string, enc: string): Uint8Array {
  switch (enc) {
    case 'utf8':
      return UTF8_ENCODER.encode(s);
    case 'utf16le': {
      // Node's `utf16le` is UTF-16 LE without BOM; surrogate pairs preserved as-is
      // (no normalisation). Two bytes per JS char-code unit.
      const out = new Uint8Array(s.length * 2);
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        out[i * 2] = code & 0xff;
        out[i * 2 + 1] = (code >> 8) & 0xff;
      }
      return out;
    }
    case 'ascii':
    case 'latin1': {
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
      return out;
    }
    case 'hex':
      return hexToBytes(s);
    case 'base64':
      return base64ToBytes(s, false);
    case 'base64url':
      return base64ToBytes(s, true);
    default:
      return encode(s, resolveEncoding(enc));
  }
}

/**
 * Decode `view` bytes to a string under `enc`. Zero-copy (reads the view
 * directly; utf8 via shared TextDecoder). Re-exported from the package index as
 * `bytesToString` (ADR-0082) for text-read callers that would otherwise copy
 * into a Buffer first.
 */
export function decode(view: Uint8Array, enc: string): string {
  switch (enc) {
    case 'utf8':
      return UTF8_DECODER.decode(view);
    case 'utf16le':
      return utf16Decode(view);
    case 'ascii':
      return asciiDecode(view);
    case 'latin1':
      return latin1Decode(view);
    case 'hex':
      return hexDecode(view);
    case 'base64':
      return base64Decode(view, false);
    case 'base64url':
      return base64Decode(view, true);
    default:
      return decode(view, resolveEncoding(enc));
  }
}

function utf16Decode(view: Uint8Array): string {
  // Pair bytes LE → 16-bit code units → string. Trailing odd byte ignored
  // (matches Node's `buffer.write` truncation behavior): `units` floors the
  // count so view[i*2] and view[i*2+1] are always in range (i < units).
  const units = view.length >>> 1;
  let s = '';
  for (let off = 0; off < units; off += FROM_CHARCODE_CHUNK) {
    const end = Math.min(off + FROM_CHARCODE_CHUNK, units);
    const codes = new Array<number>(end - off);
    for (let i = off; i < end; i++)
      codes[i - off] = (view[i * 2] ?? 0) | ((view[i * 2 + 1] ?? 0) << 8);
    s += String.fromCharCode.apply(null, codes);
  }
  return s;
}

function asciiDecode(view: Uint8Array): string {
  // Node's ascii decode is 7-bit: mask each byte with & 0x7f.
  let s = '';
  for (let off = 0; off < view.length; off += FROM_CHARCODE_CHUNK) {
    const end = Math.min(off + FROM_CHARCODE_CHUNK, view.length);
    const codes = new Array<number>(end - off);
    for (let i = off; i < end; i++) codes[i - off] = (view[i] ?? 0) & 0x7f;
    s += String.fromCharCode.apply(null, codes);
  }
  return s;
}

function latin1Decode(view: Uint8Array): string {
  let s = '';
  for (let off = 0; off < view.length; off += FROM_CHARCODE_CHUNK) {
    const end = Math.min(off + FROM_CHARCODE_CHUNK, view.length);
    const codes = new Array<number>(end - off);
    for (let i = off; i < end; i++) codes[i - off] = view[i] ?? 0;
    s += String.fromCharCode.apply(null, codes);
  }
  return s;
}

function hexDecode(view: Uint8Array): string {
  let out = '';
  for (let i = 0; i < view.length; i++) out += (view[i] ?? 0).toString(16).padStart(2, '0');
  return out;
}

function base64Decode(view: Uint8Array, url: boolean): string {
  let bin = '';
  for (let off = 0; off < view.length; off += FROM_CHARCODE_CHUNK) {
    const end = Math.min(off + FROM_CHARCODE_CHUNK, view.length);
    const codes = new Array<number>(end - off);
    for (let i = off; i < end; i++) codes[i - off] = view[i] ?? 0;
    bin += String.fromCharCode.apply(null, codes);
  }
  const b64 = btoa(bin);
  return url ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

export function compareSlices(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
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
