// S5: stream/pipeline/finished into rifty's http objects (ServerResponse, IncomingMessage socket, ClientRequest).
export default {
  kind: 'http',
  code: `
const http = require('node:http');
const { Readable, pipeline, finished } = require('node:stream');
const L = [];
const e2s = (e) => (e ? (e.code || e.name) : 'none');
const server = http.createServer((req, res) => {
  if (req.url === '/pipeline') {
    pipeline(Readable.from(['a', 'b', 'c']), res, (...a) => L.push('pipeline cb args=' + a.length + ' ' + e2s(a[0])));
  } else if (req.url === '/finished-socket') {
    try {
      finished(req.socket, (e) => L.push('finished(socket) cb ' + e2s(e)));
      L.push('finished(socket) accepted');
    } catch (e) {
      L.push('finished(socket) threw ' + e2s(e));
    }
    res.end('ok');
  } else if (req.url === '/finished-res') {
    finished(res, (e) => L.push('finished(res) cb ' + e2s(e)));
    res.end('done');
  } else if (req.url === '/pipe') {
    Readable.from(['x', 'y']).pipe(res);
  } else {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { body += d; }).on('end', () => res.end('echo:' + body));
  }
});
server.listen({ port: 0 }, async () => {
  const port = server.address().port;
  for (const p of ['/pipeline', '/finished-socket', '/finished-res', '/pipe']) {
    const r = await __riftyHttpRequest(port, p);
    L.push(p + ' status=' + r.status + ' body=' + r.body);
    await new Promise((r) => setTimeout(r, 20));
  }
  const r = await __riftyHttpRequest(port, '/echo', { method: 'POST', body: 'hello' });
  L.push('/echo body=' + r.body);
  await new Promise((r) => setTimeout(r, 20));
  console.log(L.join('\\n'));
  server.close();
});
`,
};
