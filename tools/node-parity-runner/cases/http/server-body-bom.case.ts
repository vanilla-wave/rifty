import type { ParityCase } from '../../src/types.ts';

// A response body that starts with EF BB BF reaches the client verbatim; the
// runner's body capture keeps the BOM on both sides (traps.md parity-capture-bom).
const c: ParityCase = {
  kind: 'http',
  expected: 'status:200\nbody:3:feff 41 a',
  code: `
    const http = require('node:http');
    const { Buffer } = require('node:buffer');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.end(Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x0a]));
    });
    server.listen({ port: 0 }, async () => {
      const r = await __riftyHttpRequest(server.address().port, '/bom.csv');
      console.log('status:' + r.status);
      console.log('body:' + cps(r.body));
      server.close();
    });
  `,
};

export default c;
