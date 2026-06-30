import type { ParityCase } from '../../src/types.ts';

/**
 * Real `node:http` server parity — IncomingMessage has host + rawHeaders.
 *
 * Prints shape booleans instead of exact raw header order/value: Node adds
 * socket headers (`Connection`) that the port-registry model need not mirror,
 * but packages depend on `req.headers.host` and `req.rawHeaders` existing.
 */
const c: ParityCase = {
  kind: 'http',
  expected:
    'status:200\ncontent-type:text/plain\nbody:host:true raw-array:true raw-even:true raw-host:true raw-custom:true',
  code: `
    const http = require('node:http');

    const PORT = 4211;
    const server = http.createServer((req, res) => {
      const raw = req.rawHeaders;
      const hasRawHost = Array.isArray(raw) && raw.some((name) => String(name).toLowerCase() === 'host');
      const customAt = Array.isArray(raw) ? raw.findIndex((name) => String(name).toLowerCase() === 'x-probe') : -1;
      const hasCustom = customAt >= 0 && raw[customAt + 1] === 'yes';
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end([
        'host:' + Boolean(req.headers.host),
        'raw-array:' + Array.isArray(raw),
        'raw-even:' + (Array.isArray(raw) && raw.length % 2 === 0),
        'raw-host:' + hasRawHost,
        'raw-custom:' + hasCustom,
      ].join(' '));
    });

    server.listen({ port: PORT }, async () => {
      const r = await __riftyHttpRequest(PORT, '/headers', {
        headers: { 'x-probe': 'yes' },
      });
      console.log('status:' + r.status);
      console.log('content-type:' + r.contentType);
      console.log('body:' + r.body);
    });
  `,
};

export default c;
