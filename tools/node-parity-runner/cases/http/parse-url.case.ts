import type { ParityCase } from '../../src/types.ts';

/**
 * URL parsing as used by HTTP servers/clients to inspect `req.url`.
 *
 * We deliberately use `node:url` rather than `node:http` here: in the parity
 * runner the rifty side imports only `@riftydev/runtime-js/loader`, which does NOT
 * register the `node:http` builtin (that lives in `@riftydev/net`). A real
 * `http.createServer` + `http.request` roundtrip would also diverge because
 * rifty's http runs over the port-registry rather than the OS socket layer.
 * Parsing URL shapes is the part of the http contract we can exercise inside
 * the runner today; a full server-roundtrip case is tracked separately as a
 * net-package-level integration test.
 */
const c: ParityCase = {
  code: `
    const { URL, URLSearchParams } = require('node:url');

    const u = new URL('http://example.com:8080/path/to/page?x=1&y=two&x=3#frag');
    console.log('protocol:' + u.protocol);
    console.log('host:' + u.host);
    console.log('hostname:' + u.hostname);
    console.log('port:' + u.port);
    console.log('pathname:' + u.pathname);
    console.log('search:' + u.search);
    console.log('hash:' + u.hash);

    const params = u.searchParams;
    console.log('x-all:' + JSON.stringify(params.getAll('x')));
    console.log('y:' + params.get('y'));
    console.log('has-z:' + params.has('z'));

    // Mutate + re-serialise (the path used by http clients building outgoing URLs).
    params.append('z', 'added');
    params.delete('y');
    console.log('search-after:' + u.search);

    // Standalone URLSearchParams.
    const sp = new URLSearchParams('a=1&b=2&a=3');
    console.log('sp-a:' + JSON.stringify(sp.getAll('a')));
    console.log('sp-toString:' + sp.toString());
  `,
};

export default c;
