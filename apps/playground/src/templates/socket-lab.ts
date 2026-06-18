import { MONO_FONT_STACK } from '../glue/fonts.ts';
import type { NodeServerProjectSpec } from './project-spec.ts';

export const SOCKET_LAB_SERVER_SOURCE = `// Socket Lab, running in your browser.
// The passing rows exercise real rifty socket semantics; ceiling rows must fail loud.
import { createServer, request } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect as netConnect, createServer as createNetServer } from 'node:net';
import { Readable } from 'node:stream';

const port = Number(process.env.PORT ?? 3220);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;
if (typeof WebSocket !== 'function') throw new Error('ws WebSocket constructor export missing');
if (typeof WebSocketServer !== 'function') throw new Error('ws WebSocketServer export missing');

const CAPABILITIES = [
  {
    id: 'http-server-loopback',
    band: 'HTTP',
    expected: 'supported',
    probe: 'auto',
    label: 'http.createServer + loopback port',
    evidence: 'This page and /api/* are served by one http.Server in the worker.',
  },
  {
    id: 'client-request-body-streaming',
    band: 'HTTP',
    expected: 'supported',
    probe: 'auto',
    label: 'ClientRequest body streaming',
    evidence: 'http.request writes alpha, beta, gamma as distinct live body chunks.',
  },
  {
    id: 'serverresponse-drain-emission',
    band: 'HTTP',
    expected: 'supported',
    probe: 'auto',
    label: 'ServerResponse drain',
    evidence: 'A backpressured response write resumes on the Node-style drain event.',
  },
  {
    id: 'readable-fromweb-pipe-sink',
    band: 'Streams',
    expected: 'supported',
    probe: 'auto',
    label: 'Readable.fromWeb(...).pipe(res)',
    evidence: 'WHATWG ReadableStream chunks pipe into ServerResponse without an adapter.',
  },
  {
    id: 'ws-server-local-upgrade',
    band: 'WebSocket',
    expected: 'supported',
    probe: 'auto',
    label: 'ws over http.Server upgrade',
    evidence: 'Real npm ws client connects to WebSocketServer({ server }) on localhost.',
  },
  {
    id: 'net-http-framed-server',
    band: 'Raw sockets',
    expected: 'supported',
    probe: 'auto',
    label: 'net.createServer HTTP-framed socket',
    evidence: 'The server side can receive HTTP/1.1-framed bytes from the port registry; it is not raw TCP.',
  },
  {
    id: 'net/ws-client-external-host',
    band: 'WebSocket',
    expected: 'supported',
    probe: 'manual',
    label: 'External ws client egress',
    evidence: 'Enter a ws:// or wss:// endpoint to prove non-local ws opens through native WebSocket.',
  },
  {
    id: 'browser-preview-websocket',
    band: 'WebSocket',
    expected: 'not-yet',
    probe: 'auto',
    label: 'Plain preview page native WebSocket',
    evidence: 'A node-server page is not auto-injected with the generic bridge; native browser WS cannot reach the worker port.',
  },
  {
    id: 'net-real-tcp-socket-semantics',
    band: 'Raw sockets',
    expected: 'ceiling',
    probe: 'auto',
    label: 'Real TCP net.connect',
    evidence: 'Browsers expose fetch/WebSocket, not kernel TCP sockets; net.connect must throw.',
  },
  {
    id: 'udp-dgram-surface',
    band: 'Raw sockets',
    expected: 'ceiling',
    probe: 'auto',
    label: 'UDP dgram sockets',
    evidence: 'No browser API exposes recvfrom/sendto on a UDP port.',
  },
  {
    id: 'tls-https-surface',
    band: 'TLS',
    expected: 'not-yet',
    probe: 'auto',
    label: 'node:https TLS surface',
    evidence: 'https imports, but createServer/request/get/Agent are loud NotImplementedError surfaces.',
  },
  {
    id: 'tls-raw-socket-surface',
    band: 'TLS',
    expected: 'ceiling',
    probe: 'auto',
    label: 'node:tls raw sockets',
    evidence: 'Browser TLS is owned by fetch/WebSocket; Node TLSSocket/connect cannot be exposed faithfully.',
  },
  {
    id: 'http2-surface',
    band: 'HTTP/2',
    expected: 'not-yet',
    probe: 'auto',
    label: 'node:http2',
    evidence: 'HTTP/2 needs a separate stream/framing stack over raw TCP/TLS; not claimed today.',
  },
  {
    id: 'stream-web-bridge-surface',
    band: 'Streams',
    expected: 'not-yet',
    probe: 'matrix',
    label: 'node:stream/web + toWeb',
    evidence: 'Readable.fromWeb is implemented; the full WHATWG bridge surface is not claimed.',
  },
  {
    id: 'cross-realm-preview-unbounded-body',
    band: 'Preview bridge',
    expected: 'limited',
    probe: 'matrix',
    label: 'Cross-realm unbounded bodies',
    evidence: 'Finite streaming works; buffered fallback rejects unbounded bodies instead of hanging.',
  },
  {
    id: 'cross-realm-http-loopback',
    band: 'Preview bridge',
    expected: 'not-yet',
    probe: 'matrix',
    label: 'http.request across worker realms',
    evidence: 'The port registry is realm-local; cross-worker loopback is tracked separately.',
  },
  {
    id: 'wasi-socket-syscalls',
    band: 'WASI',
    expected: 'ceiling',
    probe: 'matrix',
    label: 'WASI socket syscalls',
    evidence: 'WASI networking syscalls stay E_NOSYS because the browser does not expose raw sockets.',
  },
];

const server = createServer((req, res) => {
  void route(req, res).catch((err) => sendJson(res, 500, {
    error: String(err && err.message ? err.message : err),
    name: err && err.name ? err.name : 'Error',
  }));
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    socket.send('echo:' + bufferToText(data));
  });
});

server.listen(port, () => {
  console.log('socket lab listening on port ' + port);
});

async function route(req, res) {
  const url = new URL(req.url || '/', 'http://socket-lab.local');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    sendText(res, 200, readFileSync('public/index.html', 'utf8'), 'text/html; charset=utf-8');
    return;
  }
  if (url.pathname === '/client.js') {
    sendText(res, 200, readFileSync('public/client.js', 'utf8'), 'text/javascript; charset=utf-8');
    return;
  }
  if (url.pathname === '/styles.css') {
    sendText(res, 200, readFileSync('public/styles.css', 'utf8'), 'text/css; charset=utf-8');
    return;
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === '/api/capabilities') {
    sendJson(res, 200, { rows: CAPABILITIES });
    return;
  }
  if (url.pathname === '/api/self-test/all') {
    sendJson(res, 200, { port, results: await runAllSelfTests() });
    return;
  }
  if (url.pathname === '/api/self-test/external-ws') {
    sendJson(res, 200, await probeExternalWebSocket(url.searchParams.get('url') || ''));
    return;
  }
  if (url.pathname === '/api/echo-upload') {
    await echoUpload(req, res);
    return;
  }
  if (url.pathname === '/api/server-drain') {
    await serverDrainRoute(res);
    return;
  }
  if (url.pathname === '/api/readable-fromweb') {
    readableFromWebRoute(res);
    return;
  }
  sendJson(res, 404, { error: 'not found', path: url.pathname });
}

async function runAllSelfTests() {
  const tests = [
    ['http-server-loopback', probeHttpServerLoopback],
    ['client-request-body-streaming', probeClientRequestBodyStreaming],
    ['serverresponse-drain-emission', probeServerResponseDrain],
    ['readable-fromweb-pipe-sink', probeReadableFromWebPipe],
    ['ws-server-local-upgrade', probeLocalWsUpgrade],
    ['net-http-framed-server', probeNetHttpFramedServer],
    ['net-real-tcp-socket-semantics', probeRawTcpCeiling],
    ['udp-dgram-surface', probeDgramCeiling],
    ['tls-https-surface', probeHttpsSurface],
    ['tls-raw-socket-surface', probeTlsCeiling],
    ['http2-surface', probeHttp2Surface],
  ];
  const out = [];
  for (const [id, fn] of tests) {
    try {
      out.push(await fn(id));
    } catch (err) {
      out.push(result(id, 'fail', errorSummary(err)));
    }
  }
  return out;
}

async function probeHttpServerLoopback(id) {
  const hit = await requestText('/api/capabilities');
  const parsed = JSON.parse(hit.body);
  return result(
    id,
    hit.statusCode === 200 && Array.isArray(parsed.rows) ? 'pass' : 'fail',
    'GET /api/capabilities -> ' + hit.statusCode + ', rows=' + (parsed.rows ? parsed.rows.length : 0),
  );
}

async function probeClientRequestBodyStreaming(id) {
  const drains = [];
  const response = await new Promise((resolve, reject) => {
    const req = request({ hostname: 'localhost', port, method: 'POST', path: '/api/echo-upload' }, (res) => {
      collectResponse(res).then(resolve, reject);
    });
    req.on('error', reject);
    req.on('drain', () => drains.push('drain'));
    const first = req.write('alpha');
    const second = req.write('beta');
    const finish = () => req.end('gamma');
    if (second === false) {
      req.once('drain', finish);
      setTimeout(finish, 250);
    } else {
      queueMicrotask(finish);
    }
    req.__socketLabWrites = { first, second };
  });
  const parsed = JSON.parse(response.body);
  const chunks = parsed.chunks || [];
  const ok = response.statusCode === 200 && chunks.join('|') === 'alpha|beta|gamma';
  const drainEvidence = drains.length > 0 ? ', drain=' + drains.length : ', drain=not-needed';
  return result(id, ok ? 'pass' : 'fail', 'chunks=' + chunks.join('|') + drainEvidence);
}

async function probeServerResponseDrain(id) {
  const response = await requestText('/api/server-drain');
  const tail = response.body.split('\\n').filter(Boolean).slice(-1)[0] || '';
  const ok = response.statusCode === 200 && tail.indexOf('drain=') !== -1;
  return result(id, ok ? 'pass' : 'fail', tail || 'empty response');
}

async function probeReadableFromWebPipe(id) {
  const response = await requestText('/api/readable-fromweb');
  const ok = response.statusCode === 200 && response.body === 'from-web:a|from-web:b|done';
  return result(id, ok ? 'pass' : 'fail', 'body=' + response.body);
}

async function probeLocalWsUpgrade(id) {
  const echo = await webSocketRoundTrip('ws://localhost:' + port + '/ws', 'node-ws');
  return result(id, echo === 'echo:node-ws' ? 'pass' : 'fail', 'message=' + echo);
}

async function probeNetHttpFramedServer(id) {
  const framedPort = port + 1;
  const server = createNetServer((socket) => {
    socket.on('data', (chunk) => {
      const head = bufferToText(chunk);
      if (head.indexOf('GET /framed HTTP/1.1') === -1) return;
      queueMicrotask(() => {
        socket.write('HTTP/1.1 200 OK\\r\\ncontent-type: text/plain\\r\\ncontent-length: 6\\r\\n\\r\\nnet-ok');
        socket.end();
      });
    });
  });
  try {
    server.listen(framedPort);
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await requestText('/framed', framedPort);
    return result(
      id,
      response.statusCode === 200 && response.body === 'net-ok' ? 'pass' : 'fail',
      'HTTP-framed socket -> ' + response.statusCode + ' ' + response.body,
    );
  } finally {
    server.close();
  }
}

function probeRawTcpCeiling(id) {
  try {
    netConnect({ host: '127.0.0.1', port: 9 });
    return result(id, 'fail', 'net.connect returned a socket; expected browser ceiling');
  } catch (err) {
    return result(id, isNotImplemented(err, 'net.connect') ? 'expected-error' : 'fail', errorSummary(err));
  }
}

async function probeDgramCeiling(id) {
  try {
    const dgram = await import('node:dgram');
    const socket = dgram.createSocket('udp4');
    socket.close();
    return result(id, 'fail', 'dgram.createSocket returned a socket; expected browser ceiling');
  } catch (err) {
    return result(id, isNotImplemented(err, 'dgram') ? 'expected-error' : 'fail', errorSummary(err));
  }
}

async function probeHttpsSurface(id) {
  try {
    const https = await import('node:https');
    const created = https.createServer();
    if (created && created.close) created.close();
    return result(id, 'fail', 'https.createServer returned; update the matrix if this is now implemented');
  } catch (err) {
    return result(id, isNotImplemented(err, 'https') ? 'expected-error' : 'fail', errorSummary(err));
  }
}

async function probeTlsCeiling(id) {
  try {
    const tls = await import('node:tls');
    const socket = tls.connect(443, 'localhost');
    if (socket && socket.destroy) socket.destroy();
    return result(id, 'fail', 'tls.connect returned a socket; expected browser ceiling');
  } catch (err) {
    return result(id, isNotImplemented(err, 'tls') ? 'expected-error' : 'fail', errorSummary(err));
  }
}

async function probeHttp2Surface(id) {
  try {
    const http2 = await import('node:http2');
    const created = http2.createServer();
    if (created && created.close) created.close();
    return result(id, 'fail', 'http2.createServer returned; update the matrix if this is now implemented');
  } catch (err) {
    return result(id, isNotImplemented(err, 'http2') ? 'expected-error' : 'fail', errorSummary(err));
  }
}

async function probeExternalWebSocket(rawUrl) {
  if (!rawUrl) return result('net/ws-client-external-host', 'fail', 'missing ws:// or wss:// URL');
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return result('net/ws-client-external-host', 'fail', 'invalid URL');
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return result('net/ws-client-external-host', 'fail', 'URL must use ws:// or wss://');
  }
  const loopback = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(parsed.hostname);
  if (loopback) return result('net/ws-client-external-host', 'fail', 'use a non-local host for this row');
  try {
    await openWebSocket(rawUrl, 4000);
    return result('net/ws-client-external-host', 'pass', 'opened ' + parsed.host);
  } catch (err) {
    return result('net/ws-client-external-host', 'fail', errorSummary(err));
  }
}

function echoUpload(req, res) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(bufferToText(chunk)));
    req.on('end', () => {
      sendJson(res, 200, { chunks, body: chunks.join('') });
      resolve();
    });
  });
}

async function serverDrainRoute(res) {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.write('server-drain:start\\n');
  const writeResult = res.write('server-drain:payload:' + 'x'.repeat(4096) + '\\n');
  let drain = 'not-needed';
  if (writeResult !== true) {
    drain = 'pending';
    await new Promise((resolve) => res.once('drain', resolve));
    drain = 'emitted';
  }
  res.end('server-drain:drain=' + drain + '\\n');
}

function readableFromWebRoute(res) {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  const web = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('from-web:a|'));
      controller.enqueue(encoder.encode('from-web:b|'));
      controller.enqueue(encoder.encode('done'));
      controller.close();
    },
  });
  Readable.fromWeb(web).pipe(res);
}

function requestText(path, targetPort = port) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      req.destroy(new Error('request timeout'));
      finish(reject, new Error('request timeout for ' + path));
    }, 1500);
    const req = request({ hostname: 'localhost', port: targetPort, path }, (res) => {
      collectResponse(res).then((value) => finish(resolve, value), (err) => finish(reject, err));
    });
    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

function collectResponse(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(bufferToText(chunk)));
    res.on('end', () => resolve({ statusCode: res.statusCode, body: chunks.join('') }));
    res.on('error', reject);
  });
}

function webSocketRoundTrip(url, payload) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket timeout'));
    }, 1200);
    ws.on('open', () => ws.send(payload));
    ws.on('message', (data) => {
      clearTimeout(timer);
      const message = bufferToText(data);
      ws.close();
      resolve(message);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function openWebSocket(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket open timeout'));
    }, timeoutMs);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function sendJson(res, status, value) {
  sendText(res, status, JSON.stringify(value, null, 2), 'application/json; charset=utf-8');
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

function result(id, outcome, evidence) {
  return { id, outcome, evidence };
}

function isNotImplemented(err, feature) {
  const text = errorSummary(err);
  return text.indexOf('NotImplementedError') !== -1 && text.indexOf(feature) !== -1;
}

function errorSummary(err) {
  if (!err) return 'unknown error';
  const anyErr = err;
  const name = anyErr.name || 'Error';
  const feature = anyErr.feature ? ' ' + anyErr.feature : '';
  const message = anyErr.message || String(err);
  return name + feature + ': ' + message;
}

function bufferToText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return decoder.decode(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return decoder.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return String(data);
}
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>rifty socket lab</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="lab">
      <header class="top">
        <div>
          <p class="eyebrow">socket lab</p>
          <h1>Socket capability matrix</h1>
        </div>
        <div class="summary" id="summary">booting...</div>
      </header>
      <section class="manual">
        <label class="manual__label" for="external-url">external ws</label>
        <input id="external-url" class="manual__input" autocomplete="off" spellcheck="false" placeholder="wss://<host>/socket" />
        <button id="external-run" class="manual__button" type="button">run</button>
      </section>
      <section class="matrix" aria-live="polite">
        <div class="matrix__head">
          <span>status</span>
          <span>surface</span>
          <span>evidence</span>
        </div>
        <div id="rows" class="rows"></div>
      </section>
    </main>
    <script type="module" src="client.js"></script>
  </body>
</html>
`;

const CLIENT_JS = `const rowsEl = document.getElementById('rows');
const summaryEl = document.getElementById('summary');
const externalInput = document.getElementById('external-url');
const externalRun = document.getElementById('external-run');

const state = new Map();

function expectedLabel(value) {
  return value === 'not-yet' ? 'not yet' : value;
}

function outcomeLabel(row) {
  if (!row.result) return row.probe === 'matrix' ? expectedLabel(row.expected) : 'pending';
  if (row.result.outcome === 'expected-error') return expectedLabel(row.expected);
  if (row.result.outcome === 'pass') return 'verified';
  return 'check failed';
}

function render() {
  const rows = [...state.values()];
  rowsEl.replaceChildren(...rows.map(renderRow));
  const verified = rows.filter((row) => row.result?.outcome === 'pass').length;
  const expectedErrors = rows.filter((row) => row.result?.outcome === 'expected-error').length;
  const failures = rows.filter((row) => row.result?.outcome === 'fail').length;
  summaryEl.textContent = verified + ' verified / ' + expectedErrors + ' expected stops / ' + failures + ' failing';
  summaryEl.dataset.state = failures > 0 ? 'fail' : 'ok';
}

function renderRow(row) {
  const item = document.createElement('article');
  item.className = 'row';
  item.dataset.expected = row.expected;
  item.dataset.outcome = row.result?.outcome || (row.probe === 'matrix' ? 'matrix' : 'pending');

  const status = document.createElement('div');
  status.className = 'row__status';
  status.textContent = outcomeLabel(row);

  const surface = document.createElement('div');
  surface.className = 'row__surface';
  const band = document.createElement('span');
  band.className = 'row__band';
  band.textContent = row.band;
  const label = document.createElement('strong');
  label.textContent = row.label;
  surface.append(band, label);

  const evidence = document.createElement('p');
  evidence.className = 'row__evidence';
  evidence.textContent = row.result?.evidence || row.evidence;

  item.append(status, surface, evidence);
  return item;
}

async function json(path, init) {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
  return res.json();
}

async function boot() {
  const matrix = await json('api/capabilities');
  for (const row of matrix.rows) state.set(row.id, row);
  render();
  const self = await json('api/self-test/all');
  for (const result of self.results) {
    const row = state.get(result.id);
    if (row) row.result = result;
  }
  await probeBrowserPreviewWs();
  render();
}

async function probeBrowserPreviewWs() {
  const row = state.get('browser-preview-websocket');
  if (!row) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = proto + '//' + location.host + '/ws';
  const outcome = await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        finish({ outcome: 'expected-error', evidence: 'native browser WS did not reach ' + location.host });
      }, 700);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        finish({ outcome: 'fail', evidence: 'browser WS reached worker; update this row to supported' });
      };
      ws.onerror = () => {
        clearTimeout(timer);
        finish({ outcome: 'expected-error', evidence: 'native browser WS rejected before the bridge' });
      };
      ws.onclose = () => {
        clearTimeout(timer);
        finish({ outcome: 'expected-error', evidence: 'native browser WS closed without bridge reachability' });
      };
    } catch (err) {
      finish({ outcome: 'expected-error', evidence: String(err && err.message ? err.message : err) });
    }
  });
  row.result = { id: row.id, ...outcome };
}

externalRun.onclick = async () => {
  const row = state.get('net/ws-client-external-host');
  if (!row) return;
  row.result = { id: row.id, outcome: 'pending', evidence: 'opening...' };
  render();
  try {
    const res = await json('api/self-test/external-ws?url=' + encodeURIComponent(externalInput.value.trim()));
    row.result = res;
  } catch (err) {
    row.result = { id: row.id, outcome: 'fail', evidence: String(err && err.message ? err.message : err) };
  }
  render();
};

boot().catch((err) => {
  summaryEl.textContent = String(err && err.message ? err.message : err);
  summaryEl.dataset.state = 'fail';
});
`;

const STYLES_CSS = `:root {
  --bg: #0f1117;
  --panel: #151923;
  --panel-2: #10141c;
  --line: #293140;
  --ink: #e4ebf3;
  --muted: #8995a6;
  --green: #8ee6a9;
  --blue: #80c7ff;
  --amber: #f4c86a;
  --red: #ff7d7d;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font: 13px/1.45 ${MONO_FONT_STACK};
}

.lab {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 28px 20px 32px;
}

.top {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 18px;
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--blue);
  font-size: 11px;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
}

.summary {
  min-width: 31ch;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 9px 12px;
  color: var(--muted);
  background: var(--panel-2);
  text-align: right;
}

.summary[data-state='ok'] { color: var(--green); }
.summary[data-state='fail'] { color: var(--red); }

.manual {
  display: grid;
  grid-template-columns: max-content minmax(180px, 1fr) max-content;
  gap: 10px;
  align-items: center;
  margin: 18px 0;
}

.manual__label {
  color: var(--muted);
}

.manual__input {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--ink);
  font: inherit;
  padding: 9px 11px;
}

.manual__button {
  border: 1px solid var(--blue);
  border-radius: 6px;
  background: transparent;
  color: var(--blue);
  font: inherit;
  padding: 9px 14px;
  cursor: pointer;
}

.matrix {
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
}

.matrix__head,
.row {
  display: grid;
  grid-template-columns: minmax(96px, 0.55fr) minmax(180px, 1.1fr) minmax(260px, 1.7fr);
  gap: 12px;
  align-items: start;
}

.matrix__head {
  padding: 10px 14px;
  background: var(--panel-2);
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  font-size: 11px;
  text-transform: uppercase;
}

.row {
  padding: 13px 14px;
  border-bottom: 1px solid var(--line);
}

.row:last-child { border-bottom: 0; }

.row__status {
  width: fit-content;
  min-width: 10ch;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 3px 8px;
  text-align: center;
  color: var(--muted);
}

.row[data-outcome='pass'] .row__status { color: var(--green); }
.row[data-outcome='expected-error'] .row__status { color: var(--amber); }
.row[data-outcome='fail'] .row__status { color: var(--red); }
.row[data-expected='limited'] .row__status { color: var(--amber); }

.row__surface {
  display: grid;
  gap: 3px;
}

.row__band {
  color: var(--muted);
  font-size: 11px;
}

.row__surface strong {
  font-size: 13px;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.row__evidence {
  margin: 0;
  color: var(--muted);
  overflow-wrap: anywhere;
}

@media (max-width: 760px) {
  .top,
  .manual,
  .matrix__head,
  .row {
    grid-template-columns: 1fr;
  }

  .top {
    align-items: stretch;
  }

  .summary {
    min-width: 0;
    text-align: left;
  }

  .matrix__head {
    display: none;
  }
}
`;

export const SOCKET_LAB_README = `# Socket Lab

Socket Lab is a runnable socket capability matrix for the sandbox.

- Supported rows run live probes against the worker's real \`node:http\`,
  \`node:stream\`, and npm \`ws\` surfaces.
- Ceiling rows pass only when the runtime throws the directed
  \`NotImplementedError\` that documents the browser limit.
- External WebSocket egress has no hardcoded endpoint; enter a \`ws://\` or
  \`wss://\` URL in the preview to run that optional probe.

The raw TCP/UDP/TLS rows are intentionally not green implementations. They are
there to prove the sandbox is honest about what browsers cannot expose.
`;

export const SOCKET_LAB_TEMPLATE: NodeServerProjectSpec = {
  id: 'socket-lab',
  displayName: 'Socket Lab',
  runtime: 'node-server',
  install: { ws: '^8.18.3' },
  entry: { relativePath: '/src/main.js', content: SOCKET_LAB_SERVER_SOURCE },
  defaultPort: 3220,
  estimatedBootSeconds: 12,
  sqlite: false,
  extraFiles: {
    '/public/index.html': INDEX_HTML,
    '/public/client.js': CLIENT_JS,
    '/public/styles.css': STYLES_CSS,
    '/README.md': SOCKET_LAB_README,
  },
};
