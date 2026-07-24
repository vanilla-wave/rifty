import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'http',
  expected: [
    'http.pos-v4.before:true',
    'http.pos-v4.during:127.0.0.1|IPv4|number|true|address,family,port',
    'http.pos-v4.after:true',
    'http.opt-v4.before:true',
    'http.opt-v4.during:127.0.0.1|IPv4|number|true|address,family,port',
    'http.opt-v4.after:true',
    'net.pos-v4.before:true',
    'net.pos-v4.during:127.0.0.1|IPv4|number|true|address,family,port',
    'net.pos-v4.after:true',
    'net.opt-v4.before:true',
    'net.opt-v4.during:127.0.0.1|IPv4|number|true|address,family,port',
    'net.opt-v4.after:true',
  ].join('\n'),
  code: `
    const http = require('node:http');
    const net = require('node:net');

    const cases = [
      ['http.pos-v4', () => http.createServer(), 'positional', '127.0.0.1'],
      ['http.opt-v4', () => http.createServer(), 'options', '127.0.0.1'],
      ['net.pos-v4', () => net.createServer(), 'positional', '127.0.0.1'],
      ['net.opt-v4', () => net.createServer(), 'options', '127.0.0.1'],
    ];

    const listen = (server, kind, host) => new Promise((resolve) => {
      if (kind === 'positional') server.listen(0, host, resolve);
      else server.listen({ port: 0, host }, resolve);
    });
    const close = (server) => new Promise((resolve) => server.close(resolve));

    (async () => {
      for (const [name, create, kind, host] of cases) {
        const server = create();
        console.log(name + '.before:' + (server.address() === null));
        await listen(server, kind, host);
        const address = server.address();
        console.log(
          name + '.during:' + [
            address.address,
            address.family,
            typeof address.port,
            address.port > 0 && address.port < 65536,
            Object.keys(address).sort().join(','),
          ].join('|'),
        );
        await close(server);
        console.log(name + '.after:' + (server.address() === null));
      }
    })();
  `,
};

export default c;
