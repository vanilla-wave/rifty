import type { ParityCase } from '../../src/types.ts';

/** ADR-0574: the `Url` record — 12 keys in Node's order, `null` for absent parts, `path`, null-prototype `query`, `slashesDenoteHost`. */
const c: ParityCase = {
  // A seeded rifty process: its stderr (and `noDeprecation`) is the guest's, as in Node.
  stdin: [],
  code: `
    const url = require('node:url');
    // JSON only (console.log's own line breaking is not under test); DEP0169/0170 rows: url-legacy.test.ts.
    process.noDeprecation = true;
    const show = (f) => { try { const v = f(); console.log(JSON.stringify(v === undefined ? '<undefined>' : v), JSON.stringify(v && typeof v === 'object' ? [Object.getPrototypeOf(v)?.constructor?.name ?? null, Object.keys(v)] : '')); } catch (e) { console.log('throw', e.name, e.code, e.message); } };
    show(() => url.parse('http://u:p@a.com:8/b/c?d=e&d=f#g'));
    show(() => url.parse('/p?x'));
    show(() => url.parse('http://a.com/b?c=d', true).query);
    show(() => url.parse('http://a.com/b', true).query);
    show(() => url.parse('//a.com/b'));
    show(() => url.parse('//a.com/b', false, true));
    show(() => url.parse('mailto:x@y.com?subject=hi'));
    show(() => url.parse('javascript:alert(1)'));
    show(() => url.parse('HTTP://Ex.com/a b'));
    const u = url.parse('http://a.com/');
    console.log(u instanceof url.Url, u.constructor === url.Url, url.parse(u) === u);
  `,
};

export default c;
