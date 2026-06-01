import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    // fastify/lib/server.js does, at module top level:
    //   const http2 = require('node:http2')
    // and only calls http2.createServer / createSecureServer later, inside its
    // server-instance factory, when configured with { http2: true }. opencode
    // boots HTTP/1, so that branch never runs at boot — but the module-resolution
    // surface of node:http2 must match Node for the static graph to evaluate.
    // This case pins exactly that requireable surface (the function set + the
    // sensitiveHeaders symbol).
    //
    // (HTTP/2 multiplexes frames over a raw TCP/TLS socket, which the browser/WASI
    // realm cannot provide, so rifty's createServer/connect throw
    // NotImplementedError when actually invoked — a loud browser-ceiling facade
    // like node:tls / node:dgram. The *invocation* divergence is a by-design
    // ceiling contract, not a parity diff.)
    const http2 = require('node:http2');
    console.log('createServer', typeof http2.createServer);
    console.log('createSecureServer', typeof http2.createSecureServer);
    console.log('connect', typeof http2.connect);
    console.log('getDefaultSettings', typeof http2.getDefaultSettings);
    console.log('getPackedSettings', typeof http2.getPackedSettings);
    console.log('getUnpackedSettings', typeof http2.getUnpackedSettings);
    console.log('performServerHandshake', typeof http2.performServerHandshake);
    console.log('sensitiveHeaders', typeof http2.sensitiveHeaders);

    const bare = require('http2');
    console.log('bare === node', bare === http2 ? 1 : 0);
  `,
};

export default c;
