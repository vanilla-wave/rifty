import type { ParityCase } from '../../src/types.ts';

/**
 * Real `node:http` server parity — `createServer(options, listener)`.
 *
 * Adapter packages call the options+listener overload instead of attaching the
 * request listener later. The options object is intentionally empty here; the
 * parity point is that Node accepts the overload and wires the listener. Non-empty
 * `ServerOptions` remain a loud rifty ceiling until those options are honoured.
 */
const c: ParityCase = {
  kind: 'http',
  expected: 'status:200\ncontent-type:text/plain\nbody:options-listener:/probe',
  code: `
    const http = require('node:http');

    const PORT = 4210;
    const server = http.createServer({}, (req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('options-listener:' + req.url);
    });

    server.listen({ port: PORT }, async () => {
      const r = await __riftyHttpRequest(PORT, '/probe');
      console.log('status:' + r.status);
      console.log('content-type:' + r.contentType);
      console.log('body:' + r.body);
    });
  `,
};

export default c;
