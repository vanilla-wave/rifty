// Replay one recorded case against a `url` module. Self-contained: also sent into the isolate guest.
'use strict';
function replay(url, c) {
  const revive = (v) => {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === 'object') {
      if (v.$undefined) return undefined;
      if (typeof v.$parsed === 'string') return url.parse(v.$parsed);
      const o = {};
      for (const k of Object.keys(v)) o[k] = revive(v[k]);
      return o;
    }
    return v;
  };
  return url[c.fn](...revive(c.args));
}
module.exports = { replay };
