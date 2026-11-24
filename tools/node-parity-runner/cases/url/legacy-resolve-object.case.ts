import type { ParityCase } from '../../src/types.ts';

/** ADR-0574: `url.resolveObject` records, `new url.Url()` and the `Url.prototype` methods. */
const c: ParityCase = {
  code: `
    const url = require('node:url');
    const show = (f) => { try { const v = f(); console.log(JSON.stringify(v === undefined ? "<undefined>" : v), v && typeof v === "object" ? [Object.getPrototypeOf(v)?.constructor?.name ?? null, Object.keys(v).join(",")] : ""); } catch (e) { console.log("throw", e.name, e.code, e.message); } };
    show(() => url.resolveObject(url.parse('http://a.com/b/c?d#e'), '../f?g'));
    show(() => url.resolveObject('http://a.com/b', '//c.com/d'));
    show(() => url.resolveObject('', 'foo'));
    show(() => new url.Url());
    show(() => Object.keys(url.Url.prototype));
    const u = new url.Url();
    u.parse('http://a.com/x?y');
    show(() => [u.format(), u.resolve('z'), u.resolveObject('z').href]);
    show(() => [url.parse.name, url.format.name, url.resolve.name, url.resolveObject.name, url.Url.name]);
    show(() => Object.keys(require('node:url')).filter((k) => ['Url', 'parse', 'resolve', 'resolveObject', 'format'].includes(k)));
  `,
};

export default c;
