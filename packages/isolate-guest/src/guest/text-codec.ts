/**
 * The guest's one UTF-8 codec (ADR-0557 §5, ADR-0577): what Node's C++ `encoding_binding` does for
 * `lib/internal/encoding.js` (`node-encoding.ts`) and what the shim writes to the host. Whole
 * inputs only: Node's class keeps the stream state itself. Differential-tested against Node
 * (`tests/text-codec.test.ts`).
 */

// Captured at load, before guest code: a guest replacing a global or a prototype member must not
// break the runtime's own encode/decode, nor mute the host's fatal diagnostic (ADR-0557 §5).
const Uint8ArrayPrimordial = Uint8Array;
const Uint16ArrayPrimordial = Uint16Array;
const TypeErrorPrimordial = TypeError;
const reflectApplyPrimordial = Reflect.apply;
const fromCharCodePrimordial = String.fromCharCode;
const charCodeAtPrimordial = String.prototype.charCodeAt;
const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as Uint8Array;
const typedArraySlicePrimordial = TypedArrayPrototype.slice;
const typedArrayLengthPrimordial = Object.getOwnPropertyDescriptor(TypedArrayPrototype, 'length')
  ?.get as (this: Uint8Array) => number;
const charCodeAt = (s: string, at: number): number =>
  reflectApplyPrimordial(charCodeAtPrimordial, s, [at]) as number;
const lengthOf = (bytes: Uint8Array): number =>
  reflectApplyPrimordial(typedArrayLengthPrimordial, bytes, []) as number;

const REPLACEMENT = 0xfffd;

/** UTF-8 of a string with no member lookup the guest can replace (the host's own writes). */
export function encodeUtf8(s: string): Uint8Array {
  const out = new Uint8ArrayPrimordial(s.length * 3);
  const { written } = encodeIntoUtf8(s, out);
  return reflectApplyPrimordial(typedArraySlicePrimordial, out, [0, written]) as Uint8Array;
}

/** WHATWG `encodeInto`: whole code points that fit; a lone surrogate is U+FFFD. */
export function encodeIntoUtf8(s: string, dest: Uint8Array): { read: number; written: number } {
  const room = lengthOf(dest);
  let read = 0;
  let written = 0;
  while (read < s.length) {
    let cp = charCodeAt(s, read);
    let units = 1;
    if (cp >= 0xd800 && cp <= 0xdbff && read + 1 < s.length) {
      const low = charCodeAt(s, read + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        units = 2;
      }
    }
    if (cp >= 0xd800 && cp <= 0xdfff) cp = REPLACEMENT;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (written + size > room) break;
    if (size === 1) dest[written] = cp;
    else if (size === 2) {
      dest[written] = 0xc0 | (cp >> 6);
      dest[written + 1] = 0x80 | (cp & 0x3f);
    } else if (size === 3) {
      dest[written] = 0xe0 | (cp >> 12);
      dest[written + 1] = 0x80 | ((cp >> 6) & 0x3f);
      dest[written + 2] = 0x80 | (cp & 0x3f);
    } else {
      dest[written] = 0xf0 | (cp >> 18);
      dest[written + 1] = 0x80 | ((cp >> 12) & 0x3f);
      dest[written + 2] = 0x80 | ((cp >> 6) & 0x3f);
      dest[written + 3] = 0x80 | (cp & 0x3f);
    }
    written += size;
    read += units;
  }
  return { read, written };
}

/** Code units flushed to a string per `fromCharCode` call (+1: a pair never splits). */
const FLUSH = 0x8000;
const units = new Uint16ArrayPrimordial(FLUSH + 1);
const unitsBuffer = units.buffer;

/** The first `w` buffered units as a string. */
function flush(w: number): string {
  if (w === 0) return '';
  // A view by the captured constructor (`subarray` would read the guest-replaceable species).
  const part = new Uint16ArrayPrimordial(unitsBuffer, 0, w) as unknown as number[];
  return reflectApplyPrimordial(fromCharCodePrimordial, null, part) as string;
}

/** Node's C++ shape: a plain `TypeError` with an own `code`. */
function invalid(): TypeError {
  return Object.assign(
    new TypeErrorPrimordial('The encoded data was not valid for encoding utf-8'),
    { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' },
  );
}

/**
 * WHATWG UTF-8 decode of a whole input: maximal subpart → U+FFFD (`fatal`: throws), one leading
 * BOM dropped unless `ignoreBOM`. No closure, no array: units go through one reused buffer.
 */
export function decodeUtf8(bytes: Uint8Array, fatal: boolean, ignoreBOM: boolean): string {
  const n = lengthOf(bytes);
  let i = 0;
  if (!ignoreBOM && n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  let out = '';
  let w = 0;
  while (i < n) {
    if (w >= FLUSH) {
      out += flush(w);
      w = 0;
    }
    const b0 = bytes[i] as number;
    if (b0 < 0x80) {
      units[w++] = b0;
      i++;
      continue;
    }
    let need: number;
    let lower = 0x80;
    let upper = 0xbf;
    if (b0 >= 0xc2 && b0 <= 0xdf) need = 1;
    else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2;
      if (b0 === 0xe0) lower = 0xa0;
      else if (b0 === 0xed) upper = 0x9f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3;
      if (b0 === 0xf0) lower = 0x90;
      else if (b0 === 0xf4) upper = 0x8f;
    } else {
      if (fatal) throw invalid();
      units[w++] = REPLACEMENT;
      i++;
      continue;
    }
    let cp = b0 & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
    let k = 1;
    for (; k <= need && i + k < n; k++) {
      const b = bytes[i + k] as number;
      if (b < lower || b > upper) break;
      cp = (cp << 6) | (b & 0x3f);
      lower = 0x80;
      upper = 0xbf;
    }
    if (k <= need) {
      if (fatal) throw invalid();
      units[w++] = REPLACEMENT;
      i += k;
    } else if (cp >= 0x10000) {
      cp -= 0x10000;
      units[w++] = 0xd800 + (cp >> 10);
      units[w++] = 0xdc00 + (cp & 0x3ff);
      i += k;
    } else {
      units[w++] = cp;
      i += k;
    }
  }
  return out + flush(w);
}
