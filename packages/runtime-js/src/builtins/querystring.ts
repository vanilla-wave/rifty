/**
 * Node-compatible `node:querystring` (subset).
 *
 * Modern code prefers `URLSearchParams`, but Node still exposes this module
 * and several real packages (express, formidable) use it. We keep the API
 * surface close: `parse`, `stringify`, `escape`, `unescape`.
 */

export function escape(s: string): string {
  return encodeURIComponent(s);
}

export function unescape(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Replace literal `+` with a space — Node `querystring.parse`'s structural step. */
function plusToSpace(s: string): string {
  return s.indexOf('+') === -1 ? s : s.replace(/\+/g, ' ');
}

export function parse(
  qs: string,
  sep = '&',
  eq = '=',
  options: { maxKeys?: number; decodeURIComponent?: typeof unescape } = {},
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = Object.create(null);
  if (typeof qs !== 'string' || qs.length === 0) return out;
  const max = options.maxKeys ?? 1000;
  const decode = options.decodeURIComponent ?? unescape;
  const pairs = qs.split(sep);
  for (let i = 0; i < pairs.length && i < max; i++) {
    const raw = pairs[i] ?? '';
    const idx = raw.indexOf(eq);
    let key: string;
    let value: string;
    // Node's `parse` tokenizer turns a literal `+` into a space BEFORE percent-
    // decoding (it's structural, not part of `unescape` — `querystring.unescape`
    // alone leaves `+` intact). `%2B` survives because the replace runs on the
    // still-encoded segment, before `decode`.
    if (idx === -1) {
      key = decode(plusToSpace(raw));
      value = '';
    } else {
      key = decode(plusToSpace(raw.slice(0, idx)));
      value = decode(plusToSpace(raw.slice(idx + 1)));
    }
    if (Object.hasOwn(out, key)) {
      const existing = out[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        out[key] = [existing as string, value];
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function stringify(
  obj: Record<string, unknown> | null | undefined,
  sep = '&',
  eq = '=',
  options: { encodeURIComponent?: typeof escape } = {},
): string {
  if (obj === null || obj === undefined) return '';
  const encode = options.encodeURIComponent ?? escape;
  const parts: string[] = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = encode(k);
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${key}${eq}${encode(toScalar(item))}`);
    } else if (v === undefined || v === null) {
      parts.push(`${key}${eq}`);
    } else {
      parts.push(`${key}${eq}${encode(toScalar(v))}`);
    }
  }
  return parts.join(sep);
}

function toScalar(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return '';
}

const querystring = { escape, unescape, parse, stringify, encode: stringify, decode: parse };
export default querystring;
