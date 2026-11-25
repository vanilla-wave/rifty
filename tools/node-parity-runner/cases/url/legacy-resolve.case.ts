import type { ParityCase } from '../../src/types.ts';

/** ADR-0574: `url.resolve` over a path-only base and over absolute bases with `..` (rifty main: `'quux'`). */
const c: ParityCase = {
  // A seeded rifty process: its stderr (and `noDeprecation`) is the guest's, as in Node.
  stdin: [],
  code: `
    const url = require('node:url');
    // JSON only (console.log's own line breaking is not under test); DEP0169/0170 rows: url-legacy.test.ts.
    process.noDeprecation = true;
    const show = (f) => { try { const v = f(); console.log(JSON.stringify(v === undefined ? '<undefined>' : v), JSON.stringify(v && typeof v === 'object' ? [Object.getPrototypeOf(v)?.constructor?.name ?? null, Object.keys(v)] : '')); } catch (e) { console.log('throw', e.name, e.code, e.message); } };
    show(() => url.resolve('/foo/bar/baz', 'quux'));
    show(() => url.resolve('/foo/bar/baz', '../quux'));
    show(() => url.resolve('foo/bar', '../../../x'));
    show(() => url.resolve('https://example.com/guide/a', '../img/b.png'));
    show(() => url.resolve('http://a.com/b/c/d', '../../../../e'));
    show(() => url.resolve('http://a.com/b', '//c.com/d'));
    show(() => url.resolve('mailto:a@b.com', 'c'));
  `,
};

export default c;
