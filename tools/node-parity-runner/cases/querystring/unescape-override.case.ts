import type { ParityCase } from '../../src/types.ts';

/** ADR-0574: `querystring.parse` and `url.parse(s, true)` call the module's own (patchable) `unescape`. */
const c: ParityCase = {
  // A seeded rifty process: its stderr (and `noDeprecation`) is the guest's, as in Node.
  stdin: [],
  code: `
    const qs = require('node:querystring');
    const url = require('node:url');
    // JSON only (console.log's own line breaking is not under test); DEP0169/0170 rows: url-legacy.test.ts.
    process.noDeprecation = true;
    const show = (f) => { try { const v = f(); console.log(JSON.stringify(v === undefined ? '<undefined>' : v), JSON.stringify(v && typeof v === 'object' ? [Object.getPrototypeOf(v)?.constructor?.name ?? null, Object.keys(v)] : '')); } catch (e) { console.log('throw', e.name, e.code, e.message); } };
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
