/**
 * Host-task-async Node-surface carriers (goal honest-guest-package-adaptations
 * I1). Each CommonJS program prints at top level, then leaves exactly one
 * pending request whose settlement is a host task in Chromium; real Node keeps
 * the process alive until it settles. Executed verbatim by real Node (live
 * oracle) and by rifty `node <case>.cjs`.
 */
export interface HostAsyncCase {
  readonly name: string;
  readonly source: string;
}

const report = `const done = (label, value) => console.log('HA|' + label + '=' + value);
const fail = (label, error) => console.log('HA|' + label + '-error=' + (error && error.name) + ':' + (error && error.message));
console.log('HA|top');
`;

// 6 M-nop function body: compilation is background work in V8 (evidence §Probe 2/3 row W).
const wasmBytes = `const leb = (v) => { const o = []; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const nops = 6000000;
const bodyLen = nops + 2;
const codeLen = 1 + leb(bodyLen).length + bodyLen;
const head = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, ...leb(codeLen), 1, ...leb(bodyLen), 0];
const bytes = new Uint8Array(head.length + nops + 1);
bytes.set(head);
bytes.fill(1, head.length, head.length + nops);
bytes[bytes.length - 1] = 0x0b;
`;

const pbkdf2 = (subtle: string) => `const subtle = ${subtle};
subtle.importKey('raw', Buffer.from('password'), 'PBKDF2', false, ['deriveBits'])
  .then((key) => subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from('salt'), iterations: 3000000 }, key, 256))
  .then((bits) => done('derive-bits', Buffer.from(bits).toString('hex')), (e) => fail('derive-bits', e));
`;

export const hostAsyncCases: readonly HostAsyncCase[] = [
  {
    // The counted globals keep Node's observable shape (identity, names, instanceof).
    name: 'api-shape',
    source: `const body = Object.getOwnPropertyDescriptor(Response.prototype, 'body').get;
console.log('HA|constructors=' + [Response, Request, WebSocket, BroadcastChannel].map((C) => C.prototype.constructor === C).join(','));
console.log('HA|instances=' + [new Response('x') instanceof Response, new Response('x').clone() instanceof Response, Response.json(1) instanceof Response, new Request('http://localhost/') instanceof Request].join(','));
console.log('HA|names=' + [Blob.prototype.arrayBuffer, Blob.prototype.stream, WebAssembly.compile, WebAssembly.instantiate, crypto.subtle.deriveBits, Response.json, Response.prototype.text, body, BroadcastChannel.prototype.ref, BroadcastChannel.prototype.close].map((f) => f.name).join(','));
`,
  },
  {
    name: 'blob-array-buffer',
    source: `${report}const { Blob } = require('node:buffer');
new Blob([Buffer.alloc(64 * 1024 * 1024, 65)]).arrayBuffer()
  .then((b) => done('array-buffer', b.byteLength), (e) => fail('array-buffer', e));
`,
  },
  {
    name: 'blob-text',
    source: `${report}new Blob([Buffer.alloc(32 * 1024 * 1024, 66)]).text()
  .then((t) => done('text', t.length + ':' + t.slice(0, 3)), (e) => fail('text', e));
`,
  },
  {
    name: 'blob-bytes',
    source: `${report}new Blob([Buffer.alloc(32 * 1024 * 1024, 67)]).bytes()
  .then((u) => done('bytes', u.constructor.name + ':' + u.byteLength + ':' + u[0]), (e) => fail('bytes', e));
`,
  },
  {
    name: 'blob-stream',
    source: `${report}const reader = new Blob([Buffer.alloc(32 * 1024 * 1024, 68)]).stream().getReader();
let total = 0;
const pump = () => reader.read().then(({ done: end, value }) => {
  if (end) return done('stream', total);
  total += value.byteLength;
  return pump();
});
pump().catch((e) => fail('stream', e));
`,
  },
  {
    name: 'file-text',
    source: `${report}const { File } = require('node:buffer');
const file = new File([Buffer.alloc(32 * 1024 * 1024, 69)], 'big.txt', { type: 'text/plain' });
file.text().then((t) => done('file', file.name + ':' + file.type + ':' + t.length), (e) => fail('file', e));
`,
  },
  {
    name: 'fs-open-as-blob',
    source: `${report}const fs = require('node:fs');
fs.writeFileSync('open-as-blob.bin', Buffer.alloc(32 * 1024 * 1024, 70));
fs.openAsBlob('open-as-blob.bin')
  .then((blob) => blob.arrayBuffer())
  .then((b) => { fs.unlinkSync('open-as-blob.bin'); done('open-as-blob', b.byteLength); }, (e) => fail('open-as-blob', e));
`,
  },
  {
    name: 'webassembly-compile',
    source: `${report}${wasmBytes}WebAssembly.compile(bytes)
  .then((m) => done('compile', WebAssembly.Module.exports(m).map((e) => e.name + ':' + e.kind).join(',')), (e) => fail('compile', e));
`,
  },
  {
    name: 'webassembly-instantiate-bytes',
    source: `${report}${wasmBytes}WebAssembly.instantiate(bytes)
  .then(({ module, instance }) => done('instantiate', WebAssembly.Module.exports(module).length + ':' + typeof instance.exports.f), (e) => fail('instantiate', e));
`,
  },
  {
    name: 'subtle-derive-bits',
    source: `${report}${pbkdf2(`require('node:crypto').subtle`)}`,
  },
  {
    name: 'webcrypto-digest-chain',
    source: `${report}const subtle = globalThis.crypto.subtle;
let digest = Buffer.from('seed');
let rounds = 0;
const step = () => subtle.digest('SHA-256', digest).then((d) => {
  digest = Buffer.from(d);
  rounds += 1;
  return rounds < 200 ? step() : done('digest-chain', rounds + ':' + digest.toString('hex').slice(0, 16));
});
step().catch((e) => fail('digest-chain', e));
`,
  },
  {
    name: 'response-blob-body',
    source: `${report}new Response(new Blob([Buffer.alloc(32 * 1024 * 1024, 71)])).arrayBuffer()
  .then((b) => done('response', b.byteLength), (e) => fail('response', e));
`,
  },
  {
    name: 'request-blob-body',
    source: `${report}new Request('http://localhost/upload', { method: 'POST', body: new Blob([Buffer.alloc(32 * 1024 * 1024, 72)]) }).text()
  .then((t) => done('request', t.length + ':' + t.slice(0, 2)), (e) => fail('request', e));
`,
  },
  {
    name: 'webassembly-compile-rejects',
    source: `${report}WebAssembly.compile(new Uint8Array([0, 0x61, 0x73, 0x6d, 2, 0, 0, 0]))
  .then(() => done('compile-rejects', 'resolved'), (e) => done('compile-rejects', e.name));
`,
  },
  {
    // Over-hold guard: a guest stream body settles on guest work only; Node exits
    // with the read pending, so a held ref here would end at the drain cap instead.
    name: 'guest-stream-body-holds-nothing',
    source: `${report}const idle = new ReadableStream({ start() {} });
new Response(idle).text().then(() => done('guest-stream', 'settled'));
new Blob(['unread']).stream();
`,
  },
  {
    name: 'blob-stream-async-iterator',
    source: `${report}(async () => {
  let total = 0;
  for await (const chunk of new Blob([Buffer.alloc(32 * 1024 * 1024, 73)]).stream()) total += chunk.byteLength;
  done('async-iterator', total);
})().catch((e) => fail('async-iterator', e));
`,
  },
  {
    name: 'blob-stream-tee',
    source: `${report}const [left, right] = new Blob([Buffer.alloc(32 * 1024 * 1024, 74)]).stream().tee();
void right.cancel();
const reader = left.getReader();
let total = 0;
const pump = () => reader.read().then(({ done: end, value }) => {
  if (end) return done('tee', total);
  total += value.byteLength;
  return pump();
});
pump().catch((e) => fail('tee', e));
`,
  },
  {
    name: 'blob-stream-pipe-to',
    source: `${report}let total = 0;
new Blob([Buffer.alloc(32 * 1024 * 1024, 75)]).stream()
  .pipeTo(new WritableStream({ write(chunk) { total += chunk.byteLength; } }))
  .then(() => done('pipe-to', total), (e) => fail('pipe-to', e));
`,
  },
  {
    name: 'response-body-pipe-through',
    source: `${report}const reader = new Response(new Blob([Buffer.alloc(32 * 1024 * 1024, 76)])).body
  .pipeThrough(new TransformStream()).getReader();
let total = 0;
const pump = () => reader.read().then(({ done: end, value }) => {
  if (end) return done('pipe-through', total);
  total += value.byteLength;
  return pump();
});
pump().catch((e) => fail('pipe-through', e));
`,
  },
  {
    name: 'readable-from-web',
    source: `${report}const { Readable } = require('node:stream');
let total = 0;
Readable.fromWeb(new Blob([Buffer.alloc(32 * 1024 * 1024, 77)]).stream())
  .on('data', (chunk) => { total += chunk.length; })
  .on('end', () => done('from-web', total))
  .on('error', (e) => fail('from-web', e));
`,
  },
  {
    name: 'response-over-blob-stream',
    source: `${report}new Response(new Blob([Buffer.alloc(32 * 1024 * 1024, 78)]).stream()).arrayBuffer()
  .then((b) => done('response-stream', b.byteLength), (e) => fail('response-stream', e));
`,
  },
  {
    // An unobserved rejection stays unhandled: Node prints it and exits 1.
    name: 'webassembly-compile-unhandled',
    source: `${report}WebAssembly.compile(new Uint8Array([0]));
`,
  },
  {
    name: 'subtle-digest-unhandled',
    source: `${report}crypto.subtle.digest('invalid-algorithm', new Uint8Array([0]));
`,
  },
  {
    // Body locking, accessor reads and reflection stay the platform's own.
    name: 'body-and-reflection-shape',
    source: `let reads = 0;
new Request('http://localhost/', { method: 'POST', get body() { reads += 1; return 'abc'; } });
console.log('HA|init-body-reads=' + reads);
const outcome = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.name; } };
(async () => {
  for (const make of [() => new Response('abc'), () => new Request('http://localhost/', { method: 'POST', body: 'abc' })]) {
    const message = make();
    message.body.getReader();
    const text = await message.text().then(() => 'ok', (e) => e.name);
    console.log('HA|locked=' + [message.body.locked, message.bodyUsed, outcome(() => message.clone()), text].join(','));
  }
  console.log('HA|to-string=' + [WebAssembly.compile, WebAssembly.instantiate, Function.prototype.toString].map((f) => Function.prototype.toString.call(f)).join('|'));
})();
`,
  },
  {
    name: 'blob-stream-direct-readers',
    source: `${report}const pump = (reader, read, total = 0) => read(reader).then(({ done: end, value }) =>
  end ? total : pump(reader, read, total + value.byteLength));
pump(new ReadableStreamDefaultReader(new Blob([Buffer.alloc(16 * 1024 * 1024, 79)]).stream()), (r) => r.read())
  .then((total) => done('default-reader', total))
  .then(() => pump(new ReadableStreamBYOBReader(new Blob([Buffer.alloc(16 * 1024 * 1024, 80)]).stream()), (r) => r.read(new Uint8Array(1024 * 1024))))
  .then((total) => done('byob-reader', total), (e) => fail('readers', e));
`,
  },
  {
    // Host read done, guest sink pending forever: Node holds nothing and exits 0.
    name: 'pipe-to-stalled-guest-sink',
    source: `${report}new Blob(['abc']).stream().pipeTo(new WritableStream({
  write(chunk) { console.log('HA|sink=' + chunk.byteLength); return new Promise(() => {}); },
}));
`,
  },
  {
    name: 'pipe-through-stalled-guest-transform',
    source: `${report}const out = new Blob(['abc']).stream().pipeThrough(new TransformStream({
  transform(chunk) { console.log('HA|transform=' + chunk.byteLength); return new Promise(() => {}); },
}));
out.getReader().read().then(() => console.log('HA|never'));
`,
  },
  {
    // Pipes keep the native lock lifecycle: options read before the lock, released at the end.
    name: 'pipe-lock-lifecycle',
    source: `${report}const outcome = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.name; } };
(async () => {
  const through = new Blob(['abc']).stream();
  const out = through.pipeThrough(new TransformStream());
  const reader = out.getReader();
  while (!(await reader.read()).done);
  const settled = () => new Promise((resolve) => setTimeout(resolve, 50));
  await settled();
  console.log('HA|through-done-locked=' + through.locked);
  const canceled = new Blob(['abc']).stream();
  await canceled.pipeThrough(new TransformStream()).cancel('stop');
  await settled();
  console.log('HA|through-cancel-locked=' + canceled.locked);
  const invalid = new Blob(['abc']).stream();
  console.log('HA|through-invalid=' + outcome(() => invalid.pipeThrough({})) + ',' + invalid.locked);
  const peeked = new Blob(['abc']).stream();
  let total = 0;
  await peeked.pipeTo(new WritableStream({ write(c) { total += c.byteLength; } }), {
    get preventClose() { peeked.getReader().releaseLock(); return false; },
  });
  console.log('HA|pipe-to-peek=' + total + ',' + peeked.locked);
})().catch((e) => fail('pipe-lock', e));
`,
  },
  {
    // Native pipe order on blob streams: a getter that locks the source rejects the pipe;
    // the source stays locked through the sink's close; the body is disturbed at once.
    name: 'pipe-native-order',
    source: `${report}(async () => {
  const src = new Blob(['abc']).stream();
  const dest = new WritableStream();
  const refused = await src.pipeTo(dest, { get preventClose() { src.getReader(); return false; } })
    .then(() => 'ok', (e) => e.name);
  console.log('HA|getter-lock=' + refused + ',' + dest.locked);
  const closing = new Blob(['abc']).stream();
  await closing.pipeTo(new WritableStream({ close() { console.log('HA|locked-in-close=' + closing.locked); } }));
  const response = new Response(new Blob(['abc']));
  const piped = response.body.pipeTo(new WritableStream());
  console.log('HA|body-used-sync=' + response.bodyUsed);
  await piped;
  console.log('HA|content-type=' + JSON.stringify(new Response(new Blob(['x'], { type: 'text/x' })).headers.get('content-type')));
})().catch((e) => fail('pipe-order', e));
`,
  },
  {
    // Blob-bodied in-guest Request: its body stream reads complete (reader + pipeThrough).
    name: 'request-blob-body-stream',
    source: `${report}const request = new Request('http://localhost/upload', { method: 'POST', body: new Blob([Buffer.alloc(32 * 1024 * 1024, 81)], { type: 'text/x' }) });
console.log('HA|request-type=' + request.headers.get('content-type'));
const reader = request.body.pipeThrough(new TransformStream()).getReader();
let total = 0;
const pump = () => reader.read().then(({ done: end, value }) => {
  if (end) return done('request-stream', total);
  total += value.byteLength;
  return pump();
});
pump().catch((e) => fail('request-stream', e));
`,
  },
  {
    // Native order: a Response init getter runs before the FormData body is encoded.
    name: 'response-formdata-order',
    source: `${report}const form = new FormData();
form.append('a', new Blob(['1']));
const response = new Response(form, { get status() { form.append('b', '2'); return 200; } });
response.text().then((t) => done('formdata-order', t.includes('name="a"') + ',' + t.includes('name="b"') + ',' + response.headers.get('content-type').startsWith('multipart/form-data; boundary=')), (e) => fail('formdata-order', e));
`,
  },
  {
    // A FormData body holding a File: its Request consumer reads the Blob on the host.
    name: 'request-formdata-consumer',
    source: `${report}const form = new FormData();
form.append('a', '1');
form.append('file', new Blob([Buffer.alloc(8 * 1024 * 1024, 82)]), 'f.bin');
const request = new Request('http://localhost/upload', { method: 'POST', body: form });
request.text().then((t) => done('form-consumer', (t.length > 8 * 1024 * 1024) + ',' + /^multipart\\/form-data; boundary=/.test(request.headers.get('content-type'))), (e) => fail('form-consumer', e));
`,
  },
  {
    // \`new Request(request)\` moves a FormData-with-File body; its consumer still holds.
    name: 'request-copy-formdata-consumer',
    source: `${report}const form = new FormData();
form.append('file', new Blob([Buffer.alloc(8 * 1024 * 1024, 83)]), 'g.bin');
new Request(new Request('http://localhost/upload', { method: 'POST', body: form })).arrayBuffer()
  .then((b) => done('copy-form', b.byteLength > 8 * 1024 * 1024), (e) => fail('copy-form', e));
`,
  },
  {
    // Native clone() tees even an in-memory body over host tasks.
    name: 'response-json-clone',
    source: `${report}Response.json({ a: 1 }).clone().json()
  .then((v) => done('json-clone', JSON.stringify(v)), (e) => fail('json-clone', e));
`,
  },
  {
    name: 'response-string-clone-text',
    source: `${report}new Response('x'.repeat(16 * 1024 * 1024)).clone().text()
  .then((t) => done('clone-text', t.length), (e) => fail('clone-text', e));
`,
  },
  {
    // The original of a cloned body reads its tee branch.
    name: 'response-clone-original',
    source: `${report}const response = new Response('y'.repeat(8 * 1024 * 1024));
response.clone();
response.text().then((t) => done('clone-original', t.length), (e) => fail('clone-original', e));
`,
  },
  {
    name: 'request-blob-clone',
    source: `${report}new Request('http://localhost/upload', { method: 'POST', body: new Blob([Buffer.alloc(4 * 1024 * 1024, 84)]) }).clone().text()
  .then((t) => done('request-clone', t.length), (e) => fail('request-clone', e));
`,
  },
  {
    name: 'request-string-clone',
    source: `${report}new Request('http://localhost/upload', { method: 'POST', body: 'z'.repeat(4 * 1024 * 1024) }).clone().arrayBuffer()
  .then((b) => done('request-string-clone', b.byteLength), (e) => fail('request-string-clone', e));
`,
  },
  {
    // A frozen RequestInit with a Blob body still constructs natively.
    name: 'request-frozen-init',
    source: `${report}new Request('http://localhost/', Object.freeze({ method: 'POST', body: new Blob(['frozen']) })).text()
  .then((t) => done('frozen', t), (e) => fail('frozen', e));
`,
  },
  {
    // A Node BroadcastChannel is ref'd until close(); delivery is a host task.
    name: 'broadcast-channel-message',
    source: `${report}const a = new BroadcastChannel('rifty-bc');
const b = new BroadcastChannel('rifty-bc');
b.onmessage = (event) => { done('bc', event.data); a.close(); b.close(); };
a.postMessage('hi');
`,
  },
  {
    // An open channel holds until close(): here past ~2k unheld host tasks of a cloned body read.
    name: 'broadcast-channel-holds-until-close',
    source: `${report}const channel = new BroadcastChannel('rifty-bc-held');
const reader = new Response('x'.repeat(16 * 1024 * 1024)).clone().body.getReader();
let total = 0;
const pump = () => reader.read().then(({ done: end, value }) => {
  if (end) {
    done('bc-held', total);
    return channel.close();
  }
  total += value.byteLength;
  return pump();
});
pump().catch((e) => fail('bc-held', e));
`,
  },
  {
    // An unref'd BroadcastChannel with a listener does not hold the loop, as in Node.
    name: 'broadcast-channel-unref',
    source: `${report}const channel = new BroadcastChannel('rifty-bc-unref');
channel.onmessage = () => done('unref-message', 'unexpected');
done('unref', channel.unref() === channel);
done('ref', [typeof channel.ref, typeof channel.hasRef, channel.ref().unref() === channel].join(','));
try {
  BroadcastChannel.prototype.ref.call({});
} catch (e) {
  done('invalid-this', e.name + ':' + e.code + ':' + e.message);
}
`,
  },
  {
    name: 'zlib-gzip',
    source: `${report}const zlib = require('node:zlib');
zlib.gzip(Buffer.alloc(64 * 1024 * 1024, 65), (e, r) => (e ? fail('gzip', e) : done('gzip', r.length)));
`,
  },
  {
    name: 'zlib-gzip-stream',
    source: `${report}const zlib = require('node:zlib');
const gzip = zlib.createGzip();
const chunks = [];
gzip.on('data', (c) => chunks.push(c));
gzip.on('end', () => done('gzip-stream', Buffer.concat(chunks).length > 0));
gzip.on('error', (e) => fail('gzip-stream', e));
for (let i = 0; i < 16; i += 1) gzip.write(Buffer.alloc(4 * 1024 * 1024, 65 + i));
gzip.end();
`,
  },
];

/**
 * Global `WebSocket` (Node ≥22): an open socket holds the loop until its close.
 * A subclass overriding `addEventListener` constructs normally, and a synthetic
 * `close` event does not end the socket.
 */
export function webSocketCase(url: string): string {
  return `console.log('HA|top');
class TrackedSocket extends WebSocket {
  constructor(target) {
    super(target);
    this.listened = [];
  }
  addEventListener(type, listener, options) {
    this.listened.push(type);
    return super.addEventListener(type, listener, options);
  }
}
const socket = new TrackedSocket(${JSON.stringify(url)});
socket.addEventListener('open', () => {
  console.log('HA|open');
  socket.dispatchEvent(new Event('close'));
});
socket.addEventListener('message', (event) => console.log('HA|message=' + event.data));
socket.addEventListener('close', (event) => console.log('HA|close=' + event.code + ':' + event.reason + ':' + socket.listened.join('+')));
`;
}

/** `fetch(request)` with a FormData-with-File body sends one consistent multipart body. */
export function fetchFormDataCase(url: string): string {
  return `console.log('HA|top');
const form = new FormData();
form.append('a', '1');
form.append('file', new Blob(['hello file']), 'f.txt');
const request = new Request(${JSON.stringify(url)}, { method: 'POST', body: form });
fetch(request)
  .then((response) => response.text())
  .then((text) => console.log('HA|fetch=' + text + ',' + request.bodyUsed), (e) => console.log('HA|fetch-error=' + e.name));
`;
}

/**
 * ADR-0529 §3 classifier: work left uncounted must settle with no host task.
 * A MessageChannel ping counts host tasks while each operation runs; a timer
 * holds the loop so a miscount reports instead of being reaped.
 */
export const uncountedHostTaskCase = `const zlib = require('node:zlib');
const fsp = require('node:fs/promises');
const keep = setTimeout(() => {}, 60000);
const big = 16 * 1024 * 1024;
const readAll = async (stream) => { const reader = stream.getReader(); while (!(await reader.read()).done); };
async function ticks(label, op) {
  let count = 0;
  let live = true;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { if (live) { count += 1; channel.port2.postMessage(0); } };
  channel.port2.postMessage(0);
  try { await op(); } catch (e) { label += '-error:' + e.message; }
  live = false;
  channel.port1.close();
  console.log('HA|ticks:' + label + '=' + count);
}
(async () => {
  await ticks('fs-promises', async () => { await fsp.writeFile('ticks.bin', Buffer.alloc(big, 1)); await fsp.readFile('ticks.bin'); });
  await ticks('zlib-gzip', () => new Promise((resolve, reject) => zlib.gzip(Buffer.alloc(big, 65), (e) => (e ? reject(e) : resolve()))));
  await ticks('zlib-gzip-stream', () => new Promise((resolve, reject) => {
    const gzip = zlib.createGzip();
    gzip.on('data', () => {});
    gzip.on('end', resolve);
    gzip.on('error', reject);
    for (let i = 0; i < 4; i += 1) gzip.write(Buffer.alloc(4 * 1024 * 1024, 65 + i));
    gzip.end();
  }));
  await ticks('response-string-body', () => readAll(new Response('x'.repeat(big)).body));
  await ticks('response-bytes-body', () => readAll(new Response(new Uint8Array(big)).body));
  await ticks('request-string-body', () => readAll(new Request('http://localhost/', { method: 'POST', body: 'x'.repeat(big) }).body));
  const form = new FormData();
  form.append('a', 'x'.repeat(1024 * 1024));
  await ticks('request-string-formdata-body', () => readAll(new Request('http://localhost/', { method: 'POST', body: form }).body));
  clearTimeout(keep);
})();
`;
