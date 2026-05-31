import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    // multicast-dns/index.js does, at module top level:
    //   var dgram = require('dgram')
    // and only calls dgram.createSocket({...}) later, inside the exported
    // factory (i.e. when bonjour-service publishes mDNS at runtime). The
    // opencode server graph pulls multicast-dns transitively via
    //   server.ts -> mdns.ts -> bonjour-service -> multicast-dns
    // so the module-resolution surface of node:dgram must match Node for the
    // static graph to evaluate. This case pins exactly that parity-observable
    // surface: the module is requireable and exposes the documented shape.
    //
    // (The browser/WASI realm has no UDP socket API, so rifty's createSocket
    // throws NotImplementedError when actually invoked — a loud browser-ceiling
    // facade, like node:tls / node:zlib. Node WOULD construct a socket, so the
    // *invocation* divergence is by-design and is asserted as a rifty ceiling
    // contract in null-net-stubs, not here: a parity diff is the wrong tool for
    // a deliberate ceiling.)
    const dgram = require('node:dgram');

    console.log('createSocket type', typeof dgram.createSocket);
    console.log('Socket type', typeof dgram.Socket);
    console.log('Socket name', dgram.Socket.name);
    console.log('_createSocketHandle type', typeof dgram._createSocketHandle);

    // The bare 'dgram' specifier resolves to the same module as 'node:dgram'.
    const bare = require('dgram');
    console.log('bare === node', bare === dgram ? 1 : 0);
    console.log('bare createSocket type', typeof bare.createSocket);
  `,
};

export default c;
