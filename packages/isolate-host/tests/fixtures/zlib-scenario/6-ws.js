// Step 6: ws PerMessageDeflate without a socket: negotiate, compress with and without fin, decompress.
const { sha } = require('./lib.js');
const PerMessageDeflate = require('./node_modules/ws/lib/permessage-deflate.js');
const { format, parse } = require('./node_modules/ws/lib/extension.js');

const call = (fn, ...a) => new Promise((res, rej) => fn(...a, (e, r) => (e ? rej(e) : res(r))));
(async () => {
  const server = new PerMessageDeflate({
    serverMaxWindowBits: 10,
    clientMaxWindowBits: 11,
    threshold: 0,
    isServer: true,
  });
  const client = new PerMessageDeflate({ threshold: 0 });
  // The header round trip a real handshake does.
  const wire = (p) =>
    parse(format({ [PerMessageDeflate.extensionName]: [p] }))[PerMessageDeflate.extensionName];
  const params = server.accept(wire(client.offer()));
  client.accept(wire(params));
  console.log(`params ${JSON.stringify(params)}`);
  const messages = ['hello', 'hello hello hello', Buffer.alloc(70000, 7), 'x'.repeat(300000)];
  for (const [i, m] of messages.entries()) {
    const fin = i % 2 === 0;
    const c = await call(server.compress.bind(server), Buffer.from(m), fin);
    const d = await call(client.decompress.bind(client), c, fin);
    console.log(
      `message ${i} fin=${fin} compressed ${c.length} ${sha(c)} decompressed ${d.length} ${sha(d)}`,
    );
  }
  server.cleanup();
  client.cleanup();
})();
