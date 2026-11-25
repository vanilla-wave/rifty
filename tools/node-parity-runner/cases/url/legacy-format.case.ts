import type { ParityCase } from '../../src/types.ts';

/** ADR-0574: `url.format` of a string and of legacy objects; argument errors with Node's message. */
const c: ParityCase = {
  // A seeded rifty process: its stderr (and `noDeprecation`) is the guest's, as in Node.
  stdin: [],
  code: `
    const url = require('node:url');
    // JSON only (console.log's own line breaking is not under test); DEP0169/0170 rows: url-legacy.test.ts.
    process.noDeprecation = true;
    const show = (f) => { try { const v = f(); console.log(JSON.stringify(v === undefined ? '<undefined>' : v), JSON.stringify(v && typeof v === 'object' ? [Object.getPrototypeOf(v)?.constructor?.name ?? null, Object.keys(v)] : '')); } catch (e) { console.log('throw', e.name, e.code, e.message); } };
    show(() => url.format('http://a.com/b?c=d'));
    show(() => url.format(url.parse('HTTP://Ex.com/a b')));
    show(() => url.format({ protocol: 'http', host: 'a.com', pathname: '/x#y', query: { a: [1, 2], b: 'c d' } }));
    show(() => url.format({ protocol: 'https:', auth: 'u:p@w#x', hostname: 'a.com', port: 8, search: 'q=1', hash: 'h' }));
    show(() => url.format({ protocol: 'mailto', pathname: 'x@y.com' }));
    show(() => url.format(1));
    show(() => url.format(null));
    show(() => url.parse(null));
    show(() => url.parse(1));
    show(() => url.resolve(1, 'x'));
  `,
};

export default c;
