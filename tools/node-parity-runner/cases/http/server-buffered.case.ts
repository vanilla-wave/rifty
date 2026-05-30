import type { ParityCase } from '../../src/types.ts';

/**
 * Real `node:http` server parity — buffered `res.end(body)` (F05-M1).
 *
 * This is the FIRST parity case that exercises rifty's `node:http` *server*
 * surface head-to-head against real Node. It is enabled by the runner's opt-in
 * `kind: 'http'` net-registration mode: today the rifty side of the parity
 * runner imports only `@rifty/runtime-js/loader` + `@rifty/vfs` and never
 * registers `node:http` (that builtin lives in `@rifty/net`), so this case is
 * structurally UNREACHABLE without the opt-in mode — see `parse-url.case.ts`
 * for the historical note on why URL-only http parity was the ceiling.
 *
 * The handler mirrors `@effect/platform-node`'s `NodeHttpServer.layer`
 * consumption: `createServer()` with NO handler, then attach via
 * `server.on('request', (req, res) => …)`, `server.listen({ port }, cb)`
 * (the options-object overload, Q-2026-05-30-101), and a buffered
 * `res.writeHead(200, { 'content-type': 'application/json' })` +
 * `res.end(JSON.stringify({ version: 'x' }))`. NONE of the streaming gaps
 * ('drain'/pipe) bite on this buffered path — this proves the P3 first-light
 * shape under both runtimes.
 *
 * Driving the request is abstracted behind the runner-injected global
 * `__riftyHttpRequest(port, path)`:
 *   - Node side  → real `http.request` to `127.0.0.1:<port>` over a socket;
 *   - rifty side → `dispatchToPort(port, new Request('http://preview.local:<port><path>'))`.
 * Both normalise to `{ status, contentType, body }`. We print ONLY the fields
 * both runtimes can agree on byte-for-byte (status line code, the explicit
 * `content-type` header, and the exact body bytes) — NOT the full header set,
 * because real Node injects `Date`/`Connection`/`Keep-Alive` that the
 * port-registry model has no socket lifecycle to produce.
 */
const c: ParityCase = {
  kind: 'http',
  // Lock the exact stdout so a regression where BOTH runtimes silently emit
  // nothing (e.g. the request never resolves) is caught — two empty strings
  // would otherwise "match" each other and pass on the diff alone.
  expected: 'status:200\ncontent-type:application/json\nbody:{"version":"x"}',
  code: `
    const http = require('node:http');

    const PORT = 4201;
    // Effect-shaped consumption: no handler at construction, attach via 'request'.
    const server = http.createServer();
    server.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: 'x' }));
    });

    server.listen({ port: PORT }, async () => {
      const r = await __riftyHttpRequest(PORT, '/version');
      console.log('status:' + r.status);
      console.log('content-type:' + r.contentType);
      console.log('body:' + r.body);
    });
  `,
};

export default c;
