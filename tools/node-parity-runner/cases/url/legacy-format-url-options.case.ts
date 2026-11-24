import type { ParityCase } from '../../src/types.ts';

/**
 * ADR-0574 §5, a host with a global `URL`: `url.format(URL, options)` validates `options` as Node
 * and returns `href` where no option changes it. Options that change the output are the named
 * gap (unit test), not here.
 */
const c: ParityCase = {
  code: `
    const url = require('node:url');
    const show = (f) => { try { const v = f(); console.log(JSON.stringify(v === undefined ? "<undefined>" : v), v && typeof v === "object" ? [Object.getPrototypeOf(v)?.constructor?.name ?? null, Object.keys(v).join(",")] : ""); } catch (e) { console.log("throw", e.name, e.code, e.message); } };
    const u = new URL('http://u:p@a.com/?q#h');
    for (const o of [undefined, {}, 0, '', null, { fragment: true, search: true, auth: true, unicode: false }, 1, [], () => {}, 'x'])
      show(() => url.format(u, o));
    show(() => url.format(new URL('http://a.com/'), { fragment: false, search: false, auth: false }));
  `,
};

export default c;
