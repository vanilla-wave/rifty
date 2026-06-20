import type { ParityCase } from '../../src/types.ts';

/**
 * `querystring.parse` decodes a literal `+` to a space (express/formidable rely
 * on it) — was left as `+` because the decode path skipped the structural
 * `+`→space step. `%2B` survives (it's decoded AFTER the replace), and
 * `querystring.unescape` alone leaves `+` intact (the `+` step is parse-only).
 */
const c: ParityCase = {
  code: `
    const qs = require('node:querystring');
    console.log(JSON.stringify(qs.parse('a=b+c&d=e%20f&k=%2Bplus&e+f=1')));
    console.log(JSON.stringify(qs.unescape('a+b%20c')));
    // A custom decoder must receive '+' pre-replaced with '%20' (NOT a literal
    // space) — structural, before the decoder runs.
    console.log(JSON.stringify(qs.parse('a=b+c', '&', '=', { decodeURIComponent: (s) => '[' + s + ']' })));
  `,
};

export default c;
