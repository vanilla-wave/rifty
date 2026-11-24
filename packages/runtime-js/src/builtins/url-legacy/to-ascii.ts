/**
 * The `toASCII` step of Node's legacy `url.parse` (Node v24.16.0: ada 3.4.4
 * `ada::idna::to_ascii`; `''` = error). Input: the lowercased non-IPv6 hostname.
 * - ASCII with no `xn--` label: unchanged (ada's ASCII path only lower-cases).
 * - Else the host's WHATWG `URL`, captured at load, maps and punycodes the name
 *   with a neutral last label appended (so its IPv4 "ends in a number" rule never
 *   applies; ada has none); every resulting `xn--` label is decoded by ada's
 *   decoder (below) and the decoded name must map back to the same ASCII (ada:
 *   map- and NFC-stable, valid). Intrinsics are the ones captured at load.
 * - No `URL` at load (isolate guest): named gap.
 * Declared differences from ada (ADR, compat ⚠️): Bidi (the host checks RFC 5893
 * in full, ada per label and partly), host code points the WHATWG parser forbids
 * and ada passes, mapped `%`.
 */
import { NotImplementedError } from '@riftydev/io';

const apply = Reflect.apply;
const fromCodePoint = String.fromCodePoint;
const { trunc } = Math;
const stringIndexOf = String.prototype.indexOf;
const stringSlice = String.prototype.slice;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringLastIndexOf = String.prototype.lastIndexOf;
const stringEndsWith = String.prototype.endsWith;
const arrayJoin = Array.prototype.join;
const arraySplice = Array.prototype.splice;
/** `s` split at `.` (no `split`: it reads a guest-replaceable `String.prototype[Symbol.split]`). */
function labelsOf(s: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const dot = apply(stringIndexOf, s, ['.', from]) as number;
    out[out.length] = slice(s, from, dot === -1 ? undefined : dot);
    if (dot === -1) return out;
    from = dot + 1;
  }
}
const slice = (s: string, from: number, to?: number): string =>
  apply(stringSlice, s, to === undefined ? [from] : [from, to]) as string;
const code = (s: string, at: number): number => apply(stringCharCodeAt, s, [at]) as number;
/** `s` starts with `xn--` (no live `startsWith`). */
const isXn = (s: string, at = 0): boolean =>
  code(s, at) === 0x78 &&
  code(s, at + 1) === 0x6e &&
  code(s, at + 2) === 0x2d &&
  code(s, at + 3) === 0x2d;
const includes = (list: string[], item: string): boolean => {
  for (let i = 0; i < list.length; i++) if (list[i] === item) return true;
  return false;
};
/** Appended for the parse, cut from the result. */
const NEUTRAL = '.x';

type HostOf = (name: string) => string | undefined;

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;

function digitValue(code: number): number {
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26;
  return -1;
}

function adapt(delta: number, points: number, first: boolean): number {
  let d = trunc(first ? delta / DAMP : delta / 2);
  d += trunc(d / points);
  let k = 0;
  while (d > trunc(((BASE - TMIN) * TMAX) / 2)) {
    d = trunc(d / (BASE - TMIN));
    k += BASE;
  }
  return k + trunc(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** ada `punycode_to_utf32` (deps/ada/ada.cpp, Node v24.16.0): code points, or `undefined` on error. */
export function punycodeToCodePoints(input: string): number[] | undefined {
  if (isXn(input)) return undefined;
  const out: number[] = [];
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  let at = 0;
  const endOfAscii = apply(stringLastIndexOf, input, ['-']) as number;
  if (endOfAscii !== -1) {
    for (; at < endOfAscii; at++) {
      const c = code(input, at);
      if (c >= 0x80) return undefined;
      out[out.length] = c;
    }
    at = endOfAscii + 1;
  }
  while (at < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (at >= input.length) return undefined;
      const digit = digitValue(code(input, at++));
      if (digit < 0) return undefined;
      if (digit > trunc((MAX_INT - i) / w)) return undefined;
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      if (w > trunc(MAX_INT / (BASE - t))) return undefined;
      w *= BASE - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    if (trunc(i / (out.length + 1)) > MAX_INT - n) return undefined;
    n += trunc(i / (out.length + 1));
    i %= out.length + 1;
    if (n < 0x80) return undefined;
    apply(arraySplice, out, [i, 0, n]);
    i++;
  }
  return out;
}

function isPlainAscii(hostname: string): boolean {
  for (let i = 0; i < hostname.length; i++) {
    if (code(hostname, i) >= 0x80) return false;
    if ((i === 0 || code(hostname, i - 1) === 0x2e) && isXn(hostname, i)) return false;
  }
  return true;
}

/** `hostOf(name)`: the WHATWG host parser's hostname for `name`, `undefined` on failure. */
export function createToASCII(hostOf: HostOf | undefined): (hostname: string) => string {
  return function toASCII(hostname: string): string {
    if (isPlainAscii(hostname)) return hostname;
    if (hostOf === undefined)
      throw new NotImplementedError(
        'url.toASCII',
        'a non-ASCII or xn-- hostname label needs a WHATWG URL when the runtime loads',
      );
    const ascii = hostOf(hostname);
    if (ascii === undefined) return '';
    const labels = labelsOf(ascii);
    const inputLabels = labelsOf(hostname);
    let decoded = false;
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index] as string;
      if (!isXn(label)) continue;
      // `xn--xn--…` that is not an ASCII label of the input is a Unicode label ada encoded (its
      // ASCII part starts with `xn--`): ada validates only input `xn--` labels.
      if (isXn(label, 4) && !includes(inputLabels, label)) continue;
      const points = punycodeToCodePoints(slice(label, 4));
      if (points === undefined) return '';
      let ascii7 = true;
      for (let k = 0; k < points.length; k++) {
        const point = points[k] as number;
        if (point >= 0x80) ascii7 = false;
        if (point > 0x10ffff) return '';
      }
      // ada: an all-ASCII decoding is an error (whatwg/url#760).
      if (ascii7) return '';
      labels[index] = apply(fromCodePoint, String, points) as string;
      decoded = true;
    }
    if (!decoded) return ascii;
    return hostOf(apply(arrayJoin, labels, ['.']) as string) === ascii ? ascii : '';
  };
}

/** `hostOf` over a `URL` constructor and its `hostname` getter, both captured by the caller. */
export function nativeHostOf(
  NativeURL: typeof URL | undefined,
  hostname: ((this: URL) => string) | undefined,
): HostOf | undefined {
  if (typeof NativeURL !== 'function' || typeof hostname !== 'function') return undefined;
  return (name) => {
    let host: string;
    try {
      host = apply(hostname, new NativeURL(`http://${name}${NEUTRAL}/`), []) as string;
    } catch {
      return undefined;
    }
    return apply(stringEndsWith, host, [NEUTRAL])
      ? slice(host, 0, host.length - NEUTRAL.length)
      : undefined;
  };
}
