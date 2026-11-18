/**
 * WHATWG UTF-8 TextEncoder/TextDecoder for a bare V8 isolate (ADR-0557 §5).
 * Differential-tested against Node's (`tests/text-codec.test.ts`). Other
 * encodings are a loud gap.
 */
import { notImplemented } from './loud.ts';

// Captured at load, before guest code: a guest replacing a global or a
// prototype member must not break the runtime's own encode/decode, nor mute the
// host's fatal diagnostic (ADR-0557 §5).
const Uint8ArrayPrimordial = Uint8Array;
const reflectApplyPrimordial = Reflect.apply;
const charCodeAtPrimordial = String.prototype.charCodeAt;
const typedArraySlicePrimordial = Uint8Array.prototype.slice;
const typedArraySetPrimordial = Uint8Array.prototype.set;
const charCodeAt = (s: string, at: number): number =>
  reflectApplyPrimordial(charCodeAtPrimordial, s, [at]) as number;
const sliceBytes = (bytes: Uint8Array, start: number, end?: number): Uint8Array =>
  reflectApplyPrimordial(typedArraySlicePrimordial, bytes, [start, end]) as Uint8Array;
const setBytes = (target: Uint8Array, source: Uint8Array, at: number): void => {
  reflectApplyPrimordial(typedArraySetPrimordial, target, [source, at]);
};

const UTF8_LABELS = new Set(['utf-8', 'utf8', 'unicode-1-1-utf-8']);
const REPLACEMENT = 0xfffd;

function toBytes(input: unknown): Uint8Array {
  if (input === undefined) return new Uint8ArrayPrimordial(0);
  if (input instanceof ArrayBuffer) return new Uint8ArrayPrimordial(input);
  if (ArrayBuffer.isView(input))
    return new Uint8ArrayPrimordial(input.buffer, input.byteOffset, input.byteLength);
  if (typeof SharedArrayBuffer === 'function' && input instanceof SharedArrayBuffer)
    return new Uint8ArrayPrimordial(input);
  throw Object.assign(
    new TypeError(
      'The "input" argument must be an instance of ArrayBuffer, SharedArrayBuffer, or ArrayBufferView.',
    ),
    { code: 'ERR_INVALID_ARG_TYPE' },
  );
}

function fromCodeUnits(units: number[]): string {
  let out = '';
  for (let i = 0; i < units.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, units.slice(i, i + 0x8000));
  }
  return out;
}

export class TextEncoder {
  get encoding(): string {
    return 'utf-8';
  }

  encode(input = ''): Uint8Array {
    const s = String(input);
    const out = new Uint8ArrayPrimordial(s.length * 3);
    const { written } = encodeInto(s, out);
    return sliceBytes(out, 0, written);
  }

  encodeInto(input: string, dest: Uint8Array): { read: number; written: number } {
    return encodeInto(String(input), dest);
  }
}

function encodeInto(s: string, dest: Uint8Array): { read: number; written: number } {
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
    if (written + size > dest.length) break;
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

/** Lead byte → [continuation count, first-continuation lower, upper]. */
function lead(b: number): readonly [number, number, number] | null {
  if (b >= 0xc2 && b <= 0xdf) return [1, 0x80, 0xbf];
  if (b === 0xe0) return [2, 0xa0, 0xbf];
  if ((b >= 0xe1 && b <= 0xec) || b === 0xee || b === 0xef) return [2, 0x80, 0xbf];
  if (b === 0xed) return [2, 0x80, 0x9f];
  if (b === 0xf0) return [3, 0x90, 0xbf];
  if (b >= 0xf1 && b <= 0xf3) return [3, 0x80, 0xbf];
  if (b === 0xf4) return [3, 0x80, 0x8f];
  return null;
}

export class TextDecoder {
  readonly #fatal: boolean;
  readonly #ignoreBOM: boolean;
  #pending: Uint8Array = new Uint8ArrayPrimordial(0);
  #bomSeen = false;

  constructor(label = 'utf-8', options: { fatal?: unknown; ignoreBOM?: unknown } = {}) {
    const normalized = String(label).trim().toLowerCase();
    if (!UTF8_LABELS.has(normalized)) {
      throw notImplemented(`isolate-host.TextDecoder(${normalized})`, 'only utf-8');
    }
    // WebIDL boolean conversion: any truthy value, as Node.
    this.#fatal = Boolean(options.fatal);
    this.#ignoreBOM = Boolean(options.ignoreBOM);
  }

  get encoding(): string {
    return 'utf-8';
  }
  get fatal(): boolean {
    return this.#fatal;
  }
  get ignoreBOM(): boolean {
    return this.#ignoreBOM;
  }

  decode(input?: unknown, options: { stream?: unknown } = {}): string {
    const stream = Boolean(options.stream);
    const fresh = toBytes(input);
    let bytes = fresh;
    if (this.#pending.length > 0) {
      bytes = new Uint8ArrayPrimordial(this.#pending.length + fresh.length);
      setBytes(bytes, this.#pending, 0);
      setBytes(bytes, fresh, this.#pending.length);
    }
    this.#pending = new Uint8ArrayPrimordial(0);
    const units: number[] = [];
    const push = (cp: number): void => {
      if (!this.#bomSeen) {
        this.#bomSeen = true;
        if (cp === 0xfeff && !this.#ignoreBOM) return;
      }
      if (cp >= 0x10000) {
        const v = cp - 0x10000;
        units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      } else units.push(cp);
    };
    const fail = (): void => {
      if (this.#fatal) {
        this.#bomSeen = false;
        throw Object.assign(new TypeError('The encoded data was not valid for encoding utf-8'), {
          code: 'ERR_ENCODING_INVALID_ENCODED_DATA',
        });
      }
      push(REPLACEMENT);
    };
    let i = 0;
    while (i < bytes.length) {
      const b0 = bytes[i] as number;
      if (b0 < 0x80) {
        push(b0);
        i++;
        continue;
      }
      const shape = lead(b0);
      if (shape === null) {
        fail();
        i++;
        continue;
      }
      const [need, lower, upper] = shape;
      let cp = b0 & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
      let k = 1;
      for (; k <= need; k++) {
        if (i + k >= bytes.length) break;
        const b = bytes[i + k] as number;
        const lo = k === 1 ? lower : 0x80;
        const hi = k === 1 ? upper : 0xbf;
        if (b < lo || b > hi) break;
        cp = (cp << 6) | (b & 0x3f);
      }
      if (k > need) {
        push(cp);
        i += need + 1;
      } else if (i + k >= bytes.length && stream) {
        this.#pending = sliceBytes(bytes, i);
        break;
      } else {
        fail();
        i += k;
      }
    }
    if (!stream) this.#bomSeen = false;
    return fromCodeUnits(units);
  }
}
