// Value codec + call record for the legacy url / querystring corpora (collect.cjs, program.cjs).
// Self-contained CommonJS: the same file runs in live Node and in a rifty guest.
'use strict';

// `o[k] = v` would set the prototype for k === '__proto__'.
const put = (o, k, v) =>
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const tag = (v) => Object.prototype.toString.call(v).slice(8, -1);

/** JSON-safe argument encoding; `undefined` when a value cannot be replayed. */
function encode(v, Url) {
  if (v === undefined) return { $undefined: true };
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number')
    return Number.isFinite(v) && !Object.is(v, -0)
      ? v
      : { $num: Object.is(v, -0) ? '-0' : String(v) };
  if (typeof v === 'bigint') return { $bigint: String(v) };
  if (typeof v === 'function')
    // A global builtin (`Date`, `Math.max` is not one) replays as itself; its source does not parse.
    return typeof v.name === 'string' && globalThis[v.name] === v
      ? { $global: v.name }
      : { $fn: Function.prototype.toString.call(v) };
  if (typeof v !== 'object') return undefined;
  if (Url && v instanceof Url) return { $parsed: v.href };
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) {
      const e = encode(x, Url);
      if (e === undefined) return undefined;
      out.push(e);
    }
    return out;
  }
  const t = tag(v);
  if (t === 'RegExp') return { $re: [v.source, v.flags] };
  if (t === 'Date') return { $date: v.getTime() };
  if (t === 'Boolean' || t === 'Number' || t === 'String') return { $box: [t, v.valueOf()] };
  if (t === 'URL') return undefined;
  const proto = Object.getPrototypeOf(v);
  const entries = [];
  for (const k of Object.keys(v)) {
    const e = encode(v[k], Url);
    if (e === undefined) return undefined;
    entries.push([k, e]);
  }
  return { $obj: entries, $proto: proto === null ? null : 'Object' };
}

/** Inverse of `encode`; a plain JSON object (no `$` tag) decodes as a plain object. */
function decode(v, url) {
  if (Array.isArray(v)) return v.map((x) => decode(x, url));
  if (v === null || typeof v !== 'object') return v;
  if (v.$undefined) return undefined;
  if (typeof v.$parsed === 'string') return url.parse(v.$parsed);
  if ('$num' in v) return Number(v.$num);
  if ('$bigint' in v) return BigInt(v.$bigint);
  if ('$global' in v) return globalThis[v.$global];
  if ('$fn' in v) return Function(`return (${v.$fn});`)();
  if ('$re' in v) return new RegExp(v.$re[0], v.$re[1]);
  if ('$date' in v) return new Date(v.$date);
  if ('$box' in v) return Object(v.$box[1]);
  if ('$obj' in v) {
    const o = v.$proto === null ? Object.create(null) : {};
    for (const [k, x] of v.$obj) put(o, k, decode(x, url));
    return o;
  }
  const o = {};
  for (const k of Object.keys(v)) put(o, k, decode(v[k], url));
  return o;
}

/** One observable record: own keys in order, values, prototype name; or the thrown error. */
function record(call) {
  const val = (v) => {
    if (v === undefined) return { $undefined: true };
    if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)))
      return { $num: Object.is(v, -0) ? '-0' : String(v) };
    if (typeof v === 'bigint') return { $bigint: String(v) };
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? { $fn: v.name } : v;
    if (Array.isArray(v)) return v.map(val);
    if (ArrayBuffer.isView(v))
      return {
        $bytes: Object.getPrototypeOf(v)?.constructor?.name ?? '?',
        hex: Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      };
    const proto = Object.getPrototypeOf(v);
    const o = {
      $proto: proto === null ? null : (proto.constructor?.name ?? '?'),
      $keys: Object.keys(v),
    };
    for (const k of Object.keys(v)) put(o, k, val(v[k]));
    return o;
  };
  try {
    return { ok: val(call()) };
  } catch (e) {
    return { throw: { name: e?.name, code: e?.code, message: String(e?.message) } };
  }
}

module.exports = { encode, decode, record };
