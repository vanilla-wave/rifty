import type { ParityCase } from '../../src/types.ts';

/** ADR-0574: `querystring.parse` and `url.parse(s, true)` call the module's own (patchable) `unescape`. */
const c: ParityCase = {
  code: `
    const qs = require('node:querystring');
    const url = require('node:url');
    const show = (f) => { try { const v = f(); console.log(JSON.stringify(v === undefined ? "<undefined>" : v), v && typeof v === "object" ? [Object.getPrototypeOf(v)?.constructor?.name ?? null, Object.keys(v).join(",")] : ""); } catch (e) { console.log("throw", e.name, e.code, e.message); } };
    show(() => qs.parse('=x&&y='));
    show(() => qs.unescape('%41%zz+'));
    show(() => qs.unescapeBuffer('a+b%2', true));
    const prev = qs.unescape;
    qs.unescape = (s) => s.replace(/o/g, '_');
    show(() => qs.parse('foo=bor'));
    show(() => url.parse('http://a.com/?foo=bor', true).query);
    qs.unescape = prev;
    show(() => qs.stringify({ a: [1, 2n], b: { c: 1 }, d: NaN }, ';', ':'));
    show(() => qs.parse('a=1&b=2&c=3', null, null, { maxKeys: 2 }));
    show(() => Object.keys(qs));
  `,
};

export default c;
