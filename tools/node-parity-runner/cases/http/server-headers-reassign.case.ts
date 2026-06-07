import type { ParityCase } from '../../src/types.ts';

/**
 * Real `node:http` server parity — `req.headers` read THEN reassigned, plus a
 * non-trivial path+query (#9, gate G2).
 *
 * Pins two #9 micro-fixes head-to-head against Node:
 *  - lazy+writable `req.headers`: the handler reads `req.headers['content-type']`
 *    (materialises the lazy record) then reassigns `req.headers = {...}`
 *    (Express-style overwrite) — a getter-only regression would throw here.
 *  - single `new URL` in the request-line build: the request carries a query
 *    string, so a broken pathname+search would corrupt the body echo.
 *
 * Prints only status/content-type/body (the existing http-case convention —
 * real Node injects Date/Connection the port-registry model can't reproduce).
 */
const c: ParityCase = {
  kind: 'http',
  expected: 'status:200\ncontent-type:text/plain\nbody:ct:none reassigned:yes',
  code: `
    const http = require('node:http');

    const PORT = 4207;
    const server = http.createServer();
    server.on('request', (req, res) => {
      const ct = req.headers['content-type'] || 'none';
      req.headers = { injected: 'yes' }; // Express-style reassignment (gate G2)
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ct:' + ct + ' reassigned:' + req.headers.injected);
    });

    server.listen({ port: PORT }, async () => {
      const r = await __riftyHttpRequest(PORT, '/x?a=1&b=2');
      console.log('status:' + r.status);
      console.log('content-type:' + r.contentType);
      console.log('body:' + r.body);
    });
  `,
};

export default c;
