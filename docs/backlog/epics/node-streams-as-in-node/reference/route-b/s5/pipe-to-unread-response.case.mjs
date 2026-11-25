// S5: a source piped into a ServerResponse whose client never reads. Node pauses the source once
// write() returns false; reads stay bounded by socket buffers (Node 56–96 of 2001 here).
export default {
  kind: 'http',
  code: `
const http = require('node:http');
const { Readable } = require('node:stream');
let reads = 0;
const chunk = Buffer.alloc(16384, 97);
const server = http.createServer((req, res) => {
  const src = new Readable({ read() { reads++; this.push(reads > 2000 ? null : chunk); } });
  src.pipe(res);
});
server.listen({ port: 0 }, () => {
  const port = server.address().port;
  http.get({ port, host: '127.0.0.1', path: '/' }, (res) => {
    res.pause();
    setTimeout(() => {
      console.log('reads<=512 ' + (reads <= 512));
      process.stderr.write('reads ' + reads + '\\n');
      res.destroy();
      server.close();
      setTimeout(() => process.exit(0), 20);
    }, 300);
  });
});
`,
};
