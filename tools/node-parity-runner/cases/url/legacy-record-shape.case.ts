import type { ParityCase } from '../../src/types.ts';

/** ADR-0574: the `Url` record — 12 keys in Node's order, `null` for absent parts, `path`, null-prototype `query`, `slashesDenoteHost`. */
const c: ParityCase = {
  code: `
    const url = require('node:url');
    const show = (f) => { try { const v = f(); console.log(JSON.stringify(v === undefined ? "<undefined>" : v), v && typeof v === "object" ? [Object.getPrototypeOf(v)?.constructor?.name ?? null, Object.keys(v).join(",")] : ""); } catch (e) { console.log("throw", e.name, e.code, e.message); } };
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
