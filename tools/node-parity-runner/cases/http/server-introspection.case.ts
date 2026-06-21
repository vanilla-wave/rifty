import type { ParityCase } from '../../src/types.ts';

/**
 * `node:http` ServerResponse header-introspection parity (backlog
 * `net/http-server-introspection`), diffed head-to-head against real Node:
 *  - `getHeaders()` is a null-proto object PRESERVING value types (numeric
 *    `X-Num` stays `5`, not `"5"`),
 *  - case-insensitive `getHeader` / `hasHeader`,
 *  - `appendHeader` array-merges repeats, keeping the insertion slot,
 *  - `getHeaderNames()` returns lowercased names in insertion order,
 *  - once headers are flushed, `appendHeader` throws `ERR_HTTP_HEADERS_SENT`.
 */
const c: ParityCase = {
  kind: 'http',
  expected: [
    'status:200',
    'ct:text/plain',
    'body:proto:true|xnum:5|ct:"text/plain"|cookie:["a=1","b=2"]|names:["content-type","x-num","set-cookie"]|has:true/false|post:ERR_HTTP_HEADERS_SENT',
  ].join('\n'),
  code: `
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('X-Num', 5);
      res.appendHeader('Set-Cookie', 'a=1');
      res.appendHeader('set-cookie', 'b=2');
      const gh = res.getHeaders();
      const parts = [];
      parts.push('proto:' + (Object.getPrototypeOf(gh) === null));
      parts.push('xnum:' + JSON.stringify(gh['x-num']));
      parts.push('ct:' + JSON.stringify(res.getHeader('CONTENT-TYPE')));
      parts.push('cookie:' + JSON.stringify(res.getHeader('set-cookie')));
      parts.push('names:' + JSON.stringify(res.getHeaderNames()));
      parts.push('has:' + res.hasHeader('CONTENT-TYPE') + '/' + res.hasHeader('x-absent'));
      res.flushHeaders();
      let post = 'NOTHROW';
      try { res.appendHeader('late', '1'); } catch (e) { post = e.code; }
      parts.push('post:' + post);
      res.end(parts.join('|'));
    });
    server.listen(0, async () => {
      const r = await __riftyHttpRequest(server.address().port, '/i');
      console.log('status:' + r.status);
      console.log('ct:' + r.contentType);
      console.log('body:' + r.body);
    });
  `,
};

export default c;
