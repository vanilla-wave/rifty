/**
 * The `toASCII` step of Node's legacy `url.parse` (Node v24.16.0: ada 3.4.4
 * `ada::idna::to_ascii`; `''` = error). Input: the lowercased non-IPv6 hostname.
 * - ASCII with no `xn--` label: unchanged (ada's ASCII path only lower-cases).
 * - Else the host's WHATWG `URL`, captured at load, maps and punycodes; every
 *   resulting `xn--` label is decoded by ada's decoder (below) and the decoded
 *   name must map back to the same ASCII (ada: map- and NFC-stable, valid).
 * - No `URL` at load (isolate guest): named gap.
 * Declared differences from ada (ADR, compat ⚠️): Bidi (the host checks RFC 5893
 * in full, ada per label and partly), IPv4 from mapped digits, mapped `%`.
 */
import { NotImplementedError } from '@riftydev/io';

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
  let d = Math.trunc(first ? delta / DAMP : delta / 2);
  d += Math.trunc(d / points);
  let k = 0;
  while (d > Math.trunc(((BASE - TMIN) * TMAX) / 2)) {
    d = Math.trunc(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.trunc(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** ada `punycode_to_utf32` (deps/ada/ada.cpp, Node v24.16.0): code points, or `undefined` on error. */
export function punycodeToCodePoints(input: string): number[] | undefined {
  if (input.startsWith('xn--')) return undefined;
  const out: number[] = [];
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  let at = 0;
  const endOfAscii = input.lastIndexOf('-');
  if (endOfAscii !== -1) {
    for (; at < endOfAscii; at++) {
      const code = input.charCodeAt(at);
      if (code >= 0x80) return undefined;
      out.push(code);
    }
    at = endOfAscii + 1;
  }
  while (at < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (at >= input.length) return undefined;
      const digit = digitValue(input.charCodeAt(at++));
      if (digit < 0) return undefined;
      if (digit > Math.trunc((MAX_INT - i) / w)) return undefined;
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      if (w > Math.trunc(MAX_INT / (BASE - t))) return undefined;
      w *= BASE - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    if (Math.trunc(i / (out.length + 1)) > MAX_INT - n) return undefined;
    n += Math.trunc(i / (out.length + 1));
    i %= out.length + 1;
    if (n < 0x80) return undefined;
    out.splice(i, 0, n);
    i++;
  }
  return out;
}

function isPlainAscii(hostname: string): boolean {
  for (let i = 0; i < hostname.length; i++) if (hostname.charCodeAt(i) >= 0x80) return false;
  return !/(?:^|\.)xn--/.test(hostname);
}

/** `hostOf(name)`: the WHATWG host parser's hostname for `http://<name>/`, `undefined` on failure. */
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
    const labels = ascii.split('.');
    let decoded = false;
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index] as string;
      if (!label.startsWith('xn--')) continue;
      const points = punycodeToCodePoints(label.slice(4));
      // ada: an all-ASCII decoding is an error (whatwg/url#760).
      if (points === undefined || points.every((code) => code < 0x80)) return '';
      if (points.some((code) => code > 0x10ffff)) return '';
      labels[index] = String.fromCodePoint(...points);
      decoded = true;
    }
    if (!decoded) return ascii;
    return hostOf(labels.join('.')) === ascii ? ascii : '';
  };
}

/** `hostOf` over a `URL` constructor and its `hostname` getter, both captured by the caller. */
export function nativeHostOf(
  NativeURL: typeof URL | undefined,
  hostname: ((this: URL) => string) | undefined,
): HostOf | undefined {
  if (typeof NativeURL !== 'function' || typeof hostname !== 'function') return undefined;
  return (name) => {
    try {
      return Reflect.apply(hostname, new NativeURL(`http://${name}/`), []) as string;
    } catch {
      return undefined;
    }
  };
}
