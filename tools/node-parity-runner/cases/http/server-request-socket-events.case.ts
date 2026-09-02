import type { ParityCase } from '../../src/types.ts';

/** Real `node:http` parity — request sockets support lifecycle listeners. */
const c: ParityCase = {
  kind: 'http',
  expected: 'status:200\ncontent-type:text/plain\nbody:listeners:true active:true once:true',
  code: `
    const http = require('node:http');

    const server = http.createServer((req, res) => {
      const listener = () => {};
      req.socket.on('error', listener);
      req.socket.on('close', listener);
      req.socket.removeListener('error', listener);
      req.socket.removeListener('close', listener);

      let calls = 0;
      req.socket.once('__rifty_probe', () => calls++);
      req.socket.emit('__rifty_probe');
      req.socket.emit('__rifty_probe');

      const listeners =
        typeof req.socket.on === 'function' &&
        typeof req.socket.removeListener === 'function';
      const active =
        req.socket.readable === true &&
        req.socket.writable === true &&
        req.socket.destroyed === false;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('listeners:' + listeners + ' active:' + active + ' once:' + (calls === 1));
    });

    server.listen({ port: 0 }, async () => {
      const port = server.address().port;
      const r = await __riftyHttpRequest(port, '/socket');
      console.log('status:' + r.status);
      console.log('content-type:' + r.contentType);
      console.log('body:' + r.body);
    });
  `,
};

export default c;
