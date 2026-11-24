import type { ParityCase } from '../../src/types.ts';

/**
 * ADR-0574: auth, port, IPv6, invalid hosts (`ERR_INVALID_URL`) and IDNA hostnames. `aא.com`
 * (Node `xn--a-0hc.com`) is the declared Bidi residual of the host-URL `toASCII` (contract
 * Acceptance 4), pinned in tests/browser-unit, not here.
 */
const c: ParityCase = {
  // A seeded rifty process: its stderr (and `noDeprecation`) is the guest's, as in Node.
  stdin: [],
  code: `
    const url = require('node:url');
    // JSON only (console.log's own line breaking is not under test); DEP0169/0170 rows: url-legacy.test.ts.
    process.noDeprecation = true;
    const show = (f) => { try { const v = f(); console.log(JSON.stringify(v === undefined ? '<undefined>' : v), JSON.stringify(v && typeof v === 'object' ? [Object.getPrototypeOf(v)?.constructor?.name ?? null, Object.keys(v)] : '')); } catch (e) { console.log('throw', e.name, e.code, e.message); } };
    for (const s of [
      'http://user:pa%20ss@a.com:8080/x',
      'http://[::1]:8/', 'http://[fe80::1%25en0]/', 'http://a.com:xx/',
      'http://[127.0.0.1\\x00c8763]:8000/', 'http://\\u00ad/bad.com/',
      'http://ñ.com/', 'http://faß.de/', 'http://xn--ida.com/', 'http://XN--IDA.com/',
      'http://xn--/', 'http://xn--a.com/', 'http://a％41.com/x',
    ]) show(() => { const u = url.parse(s); return [u.auth, u.host, u.hostname, u.port, u.pathname]; });
  `,
};

export default c;
