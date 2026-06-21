import type { ParityCase } from '../../src/types.ts';

/**
 * `server.listen(0)` / `listen({ port: 0 })` ephemeral-port parity (backlog
 * `net/listen-zero-ephemeral-ports`). The chosen port DIFFERS across runtimes
 * (real OS ephemeral vs rifty's virtual registry port), so the case diffs the
 * observable contract instead of the literal number: `address().port` is a
 * positive in-range integer, the bound server is reachable at that port through
 * the request driver, and two concurrent `listen(0)` servers get DISTINCT,
 * independently routable ports. This is the exact pattern that lets the parity
 * harness drop hardcoded Node-side ports.
 */
const c: ParityCase = {
  kind: 'http',
  expected: [
    'a.typeof:number',
    'a.inrange:true',
    'a.body:A:/p',
    'b.inrange:true',
    'b.body:B:/p',
    'distinct:true',
  ].join('\n'),
  code: `
    const http = require('node:http');
    function serve(label, useObject) {
      return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end(label + ':' + req.url);
        });
        const onListen = async () => {
          const port = server.address().port;
          const r = await __riftyHttpRequest(port, '/p');
          resolve({ port, body: r.body });
        };
        if (useObject) server.listen({ port: 0 }, onListen);
        else server.listen(0, onListen);
      });
    }
    (async () => {
      const a = await serve('A', false);
      const b = await serve('B', true);
      console.log('a.typeof:' + typeof a.port);
      console.log('a.inrange:' + (a.port > 0 && a.port < 65536));
      console.log('a.body:' + a.body);
      console.log('b.inrange:' + (b.port > 0 && b.port < 65536));
      console.log('b.body:' + b.body);
      console.log('distinct:' + (a.port !== b.port));
    })();
  `,
};

export default c;
