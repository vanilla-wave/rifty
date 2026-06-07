/**
 * Encode/decode helpers for the Buffer polyfill. Split out of `buffer.ts` to
 * keep that file under the ADR-0024 line budget.
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
  | 'binary';

// Module-level singletons: one-shot utf8 encode/decode is stateless (no
// {stream:true}), so a shared instance is byte-identical and avoids per-call
// allocation. Decoder uses DEFAULT config (non-fatal) — bad bytes -> U+FFFD.
// Do NOT use these for the streaming {stream:true} decoder (cross-chunk state).
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8');

// Batch code units through String.fromCharCode.apply in slices of this size to
// avoid the O(n^2) per-char string concat, while staying under the engine
// apply arg-count ceiling (~65535 on V8/JSC).
const FROM_CHARCODE_CHUNK = 0x2000; // 8192

function isUtf16(enc: Encoding): boolean {
  return enc === 'utf16le' || enc === 'utf-16le' || enc === 'ucs2' || enc === 'ucs-2';
}

export function encode(s: string, enc: Encoding): Uint8Array {
  if (enc === 'utf8' || enc === 'utf-8') return UTF8_ENCODER.encode(s);
  if (isUtf16(enc)) {
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

/**
 * Decode `view` bytes to a string under `enc`. Zero-copy (reads the view
 * directly; utf8 via shared TextDecoder). Re-exported from the package index as
 * `bytesToString` (ADR-0082) for text-read callers that would otherwise copy
 * into a Buffer first.
 */
export function decode(view: Uint8Array, enc: Encoding): string {
  if (enc === 'utf8' || enc === 'utf-8') return UTF8_DECODER.decode(view);
  if (isUtf16(enc)) {
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
  if (enc === 'ascii') {
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
  if (enc === 'latin1' || enc === 'binary') {
    let s = '';
    for (let off = 0; off < view.length; off += FROM_CHARCODE_CHUNK) {
      const end = Math.min(off + FROM_CHARCODE_CHUNK, view.length);
      const codes = new Array<number>(end - off);
      for (let i = off; i < end; i++) codes[i - off] = view[i] ?? 0;
      s += String.fromCharCode.apply(null, codes);
    }
    return s;
  }
  if (enc === 'hex') {
    let out = '';
    for (let i = 0; i < view.length; i++) out += (view[i] ?? 0).toString(16).padStart(2, '0');
    return out;
  }
  if (enc === 'base64' || enc === 'base64url') {
    let bin = '';
    for (let off = 0; off < view.length; off += FROM_CHARCODE_CHUNK) {
      const end = Math.min(off + FROM_CHARCODE_CHUNK, view.length);
      const codes = new Array<number>(end - off);
      for (let i = off; i < end; i++) codes[i - off] = view[i] ?? 0;
      bin += String.fromCharCode.apply(null, codes);
    }
    const b64 = btoa(bin);
    return enc === 'base64url'
      ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      : b64;
  }
  throw new Error(`Unsupported encoding: ${enc}`);
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
