// One observable record per call: own keys in order, values, prototype name; or the thrown error.
// Self-contained: its source is also sent into the isolate guest (compare.mjs).
'use strict';
function normalize(call) {
  const val = (v) => {
    if (v === undefined) return { $undefined: true };
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(val);
    const proto = Object.getPrototypeOf(v);
    const o = {
      $proto: proto === null ? null : (proto.constructor?.name ?? '?'),
      $keys: Object.keys(v),
    };
    for (const k of Object.keys(v)) o[k] = val(v[k]);
    return o;
  };
  try {
    return { ok: val(call()) };
  } catch (e) {
    return { throw: { name: e?.name, code: e?.code, message: String(e?.message) } };
  }
}
module.exports = { normalize };
