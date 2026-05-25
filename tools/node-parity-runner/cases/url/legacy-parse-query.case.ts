import type { ParityCase } from '../../src/types.ts';

/**
 * Pins Node's deprecated `url.parse(input, parseQueryString)` behaviour:
 *   - `parseQueryString=false` (default): `query` is the string after `?`
 *     (or `null` when there's no search).
 *   - `parseQueryString=true`: `query` is the parsed object (or `{}` when
 *     there's no search).
 *
 * The pre-fix rifty implementation returned the raw string regardless of the
 * flag and used `undefined` for empty queries, which broke common libraries
 * that branch on `typeof query === 'string'` vs `'object'`.
 */
const c: ParityCase = {
  code: `
    const url = require('node:url');

    const u1 = url.parse('http://example.com/p?a=1&b=2');
    console.log(typeof u1.query, JSON.stringify(u1.query));

    const u2 = url.parse('http://example.com/p?a=1&b=2', true);
    console.log(typeof u2.query, JSON.stringify(u2.query));

    const u3 = url.parse('http://example.com');
    console.log(typeof u3.query, JSON.stringify(u3.query));

    const u4 = url.parse('http://example.com', true);
    console.log(typeof u4.query, JSON.stringify(u4.query));

    // Repeated keys collect into arrays in querystring.parse semantics.
    const u5 = url.parse('http://example.com/?x=1&x=2&y=z', true);
    console.log(JSON.stringify(u5.query));
  `,
};

export default c;
