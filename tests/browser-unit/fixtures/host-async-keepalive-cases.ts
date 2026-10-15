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
console.log('HA|constructors=' + [Response, Request, WebSocket].map((C) => C.prototype.constructor === C).join(','));
console.log('HA|instances=' + [new Response('x') instanceof Response, new Response('x').clone() instanceof Response, Response.json(1) instanceof Response, new Request('http://localhost/') instanceof Request].join(','));
console.log('HA|names=' + [Blob.prototype.arrayBuffer, Blob.prototype.stream, WebAssembly.compile, WebAssembly.instantiate, crypto.subtle.deriveBits, Response.json, Response.prototype.text, body].map((f) => f.name).join(','));
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

/** Global `WebSocket` (Node ≥22): an open socket holds the loop until its close. */
export function webSocketCase(url: string): string {
  return `console.log('HA|top');
const socket = new WebSocket(${JSON.stringify(url)});
socket.onopen = () => console.log('HA|open');
socket.onmessage = (event) => console.log('HA|message=' + event.data);
socket.onclose = (event) => console.log('HA|close=' + event.code + ':' + event.reason);
`;
}
