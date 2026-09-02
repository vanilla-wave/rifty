import type { NpmDevServerProjectSpec } from './project-spec.ts';

const READY_TEXT = 'node-ws ready';

function pageOrigin(): string {
  if (typeof globalThis.location === 'undefined') return 'http://localhost';
  const { origin } = globalThis.location;
  if (origin.length === 0 || origin === 'null') {
    throw new TypeError('npm-dev-server-node-ws template requires a browser location origin');
  }
  return origin;
}

const ALLOWED_ORIGIN = pageOrigin();

const SERVER_SOURCE = `import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 5191);
const ALLOWED_ORIGIN = ${JSON.stringify(ALLOWED_ORIGIN)};
const root = process.cwd();
const htmlPath = join(root, 'public/index.html');
const messagePath = join(root, 'public/message.txt');
const clients = new Set();

function acceptKey(key) {
  return createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function sendText(socket, text) {
  const payload = Buffer.from(String(text));
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    throw new RangeError('node-ws text frame too large');
  }
  socket.write(Buffer.concat([header, payload]));
}

function currentMessage() {
  return readFileSync(messagePath, 'utf8').trim();
}

const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(htmlPath));
    return;
  }
  if (req.url === '/message.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(readFileSync(messagePath));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.on('upgrade', (req, socket) => {
  if (req.headers.origin !== ALLOWED_ORIGIN) {
    socket.write('HTTP/1.1 403 Forbidden\\r\\nConnection: close\\r\\n\\r\\nInvalid Origin');
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return;
  }
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Accept: ' + acceptKey(key),
      '',
      '',
    ].join('\\r\\n'),
  );
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
  sendText(socket, currentMessage());
});

let last = '';
function pollMessage() {
  const next = currentMessage();
  if (next !== last) {
    last = next;
    for (const socket of clients) sendText(socket, next);
  }
  setTimeout(pollMessage, 250);
}
pollMessage();

server.listen(PORT, () => {
  console.log('node-ws listening ' + String(PORT));
});
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>npm-owned node ws</title>
  </head>
  <body>
    <h1 id="app">${READY_TEXT}</h1>
    <script>
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(proto + '//' + location.host + '/live');
      ws.addEventListener('message', (event) => {
        document.getElementById('app').textContent = event.data;
      });
    </script>
  </body>
</html>
`;

const README = `# npm-dev-server node ws

Class-proof fixture for the generic \`npm-dev-server\` seam:

- \`package.json\` \`scripts.dev\` is ordinary \`node server.mjs\` — no extra npm deps.
- The server allow-lists the exact Playground page origin and refuses any other Origin.
- Preview updates travel over a stock browser WebSocket through the generic bridge.

Not a product starter. Deep-link only: \`?preset=npm-dev-server-node-ws\`.
`;

export const NPM_DEV_SERVER_NODE_WS_TEMPLATE: NpmDevServerProjectSpec = {
  id: 'npm-dev-server-node-ws',
  displayName: 'npm-dev-server node ws',
  runtime: 'npm-dev-server',
  install: {},
  entry: { relativePath: '/server.mjs', content: SERVER_SOURCE },
  defaultPort: 5191,
  estimatedBootSeconds: 15,
  devCommand: 'node server.mjs',
  extraFiles: {
    '/public/index.html': INDEX_HTML,
    '/public/message.txt': `${READY_TEXT}\n`,
    '/README.md': README,
  },
};
