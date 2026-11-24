// Invariant evidence on main: one guest program, run by real Node (`node -e`), rifty's isolate host
// (`runCode`) and rifty's browser-host zlib module in this process (Node's CompressionStream, not
// Chromium's). usage: node --import tsx main-red.mjs REPO
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const [repo] = process.argv.slice(2);
const T = 'the quick brown fox jumps over the lazy dog '.repeat(200);
const b64 = (b) => Buffer.from(b).toString('base64');
const corrupt = Buffer.from(zlib.deflateSync(T));
corrupt[20] ^= 0x55;
const V = {
  z: b64(zlib.deflateSync(T)),
  g2: b64(Buffer.concat([zlib.gzipSync('first '), zlib.gzipSync('second')])),
  bad: b64(corrupt),
};
// Each case: [name, () => value | Promise<value>]; printed as {ok} or {err}.
const PROGRAM = `
const V = ${JSON.stringify(V)};
const T = ${JSON.stringify(T)};
const B = (s) => Buffer.from(s, 'base64');
const cb = (fn) => new Promise((res, rej) => fn((e, r) => (e ? rej(e) : res(r))));
const hex = (b) => require('crypto').createHash('sha256').update(b).digest('hex').slice(0, 12) + ':' + b.length;
const cases = [
  ['deflateSync', () => hex(zlib.deflateSync(T))],
  ['inflateSync', () => zlib.inflateSync(B(V.z)).length],
  ['gzipSync level 1', () => hex(zlib.gzipSync(T, { level: 1 }))],
  ['crc32', () => zlib.crc32('hello')],
  ['createDeflateRaw', () => typeof zlib.createDeflateRaw().write],
  ['new Inflate', () => typeof new zlib.Inflate().write],
  ['Inflate.call (pngjs shape)', () => { function S() { zlib.Inflate.call(this); } require('util').inherits(S, zlib.Inflate); return typeof new S()._processChunk; }],
  ['deflate async level 1 bytes', () => cb((k) => zlib.deflate(T, { level: 1 }, k)).then(hex)],
  ['deflate async level 9 bytes', () => cb((k) => zlib.deflate(T, { level: 9 }, k)).then(hex)],
  ['inflate async + LF tail', () => cb((k) => zlib.inflate(Buffer.concat([B(V.z), Buffer.from('\\n')]), k)).then((r) => r.length)],
  ['gunzip async 2 members', () => cb((k) => zlib.gunzip(B(V.g2), k)).then(String)],
  ['inflate async corrupt', () => cb((k) => zlib.inflate(B(V.bad), k)).then((r) => r.length)],
  ['unzip async', () => cb((k) => zlib.unzip(B(V.z), k)).then((r) => r.length)],
  ['deflate windowBits 9', () => cb((k) => zlib.deflate(T, { windowBits: 9 }, k)).then(hex)],
  ['createGzip flush()', () => { const g = zlib.createGzip(); g.flush(); return 'ok'; }],
];
(async () => {
  for (const [name, fn] of cases) {
    let r;
    try { r = { ok: await fn() }; } catch (e) { r = { err: (e && e.name) + ': ' + String(e && e.message).slice(0, 90) + (e && e.code ? ' [' + e.code + ']' : '') }; }
    console.log(JSON.stringify([name, r]));
  }
})();
`;
const parse = (s) =>
  s
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('['))
    .map((l) => JSON.parse(l));
const node = parse(
  execFileSync(process.execPath, ['-e', `const zlib = require('zlib');${PROGRAM}`], {
    encoding: 'utf8',
  }),
);
const { runCode } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/src/index.ts')).href
);
const iso = await runCode(`const zlib = require('zlib');${PROGRAM}`, { timeoutMs: 20000 });
const isolate = parse(iso.stdout);
const browserZlib = (
  await import(pathToFileURL(join(repo, 'packages/runtime-js/src/builtins/zlib.ts')).href)
).default;
const lines = [];
const log = console.log;
console.log = (l) => lines.push(l);
await new Function(
  'zlib',
  'require',
  `return (async () => { ${PROGRAM.replace('(async () => {', 'await (async () => {')} })()`,
)(browserZlib, (await import('node:module')).createRequire(import.meta.url));
await new Promise((r) => setTimeout(r, 500));
console.log = log;
const browser = parse(lines.join('\n'));
const show = (r) => (r ? (r.ok !== undefined ? `ok ${r.ok}` : r.err) : 'no result');
console.log(
  `node ${process.version}; isolate exit ${iso.exitCode}${iso.stderr ? ` stderr ${iso.stderr.slice(0, 120)}` : ''}`,
);
console.log('case | real Node | rifty isolate host | rifty browser-host zlib.ts (in-process)');
node.forEach(([name, r], i) =>
  console.log(`${name} | ${show(r)} | ${show(isolate[i]?.[1])} | ${show(browser[i]?.[1])}`),
);
process.exit(0);
