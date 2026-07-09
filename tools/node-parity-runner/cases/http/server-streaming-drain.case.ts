import type { ParityCase } from '../../src/types.ts';

/**
 * Real `node:http` server parity — chunked streaming write loop with `'drain'`
 * (F05-M1, Q-2026-05-30-102).
 *
 * `@effect/platform-node`'s streaming response loop in `internal/httpServer.ts`
 * ignores `res.write()`'s boolean/Promise return and instead parks on the
 * Node-style `'drain'` event when the socket buffer is full, resuming the loop
 * once `'drain'` fires. rifty's `ServerResponse` historically signalled
 * backpressure ONLY via `write()`'s `boolean | Promise<boolean>` return and
 * never emitted `'drain'`, so this exact loop would hang. Q-2026-05-30-102 made
 * `ServerResponse` emit a Node-style `'drain'` on the next `pull()` after a
 * backpressured write — this case proves that loop terminates AND delivers
 * ordered bytes identically under real Node and rifty.
 *
 * The handler writes many chunks and parks on `'drain'` whenever `write()` did
 * not return strictly `true` — mirroring Effect, which never trusts the write
 * return and resumes on the event. Under Node a backpressured `write()` returns
 * `false`; under rifty it returns a `Promise` (also `!== true`). In BOTH cases
 * the loop parks on `'drain'`: Node emits it once its socket buffer drains,
 * rifty emits it on the next `pull()` (Q-2026-05-30-102). We assert the
 * fully-assembled body length and its first/last bytes match — NOT chunk
 * framing, which differs by transport (real socket vs port-registry stream).
 */
const c: ParityCase = {
  kind: 'http',
  expected: 'status:200\nlen:5000\nfirst:chunk-0000\nlast:chunk-0499',
  code: `
    const http = require('node:http');

    const N = 500;
    const server = http.createServer();
    server.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      let i = 0;
      const pump = () => {
        while (i < N) {
          // Each chunk is exactly 10 bytes: "chunk-NNNN".
          const chunk = 'chunk-' + String(i).padStart(4, '0');
          i++;
          // Effect shape: never trust the return; park on 'drain' whenever the
          // write did not report a clean synchronous true.
          if (res.write(chunk) !== true) {
            res.once('drain', pump);
            return;
          }
        }
        res.end();
      };
      pump();
    });

    server.listen({ port: 0 }, async () => {
      const port = server.address().port;
      const r = await __riftyHttpRequest(port, '/stream');
      console.log('status:' + r.status);
      console.log('len:' + r.body.length);
      console.log('first:' + r.body.slice(0, 10));
      console.log('last:' + r.body.slice(-10));
    });
  `,
};

export default c;
