// The carrier's browser-host pins, measured in real Chromium (148, @playwright/test 1.60.0): rifty's
// browser-host `node:zlib` (packages/runtime-js/src/builtins/zlib.ts on main), bundled by esbuild,
// in a dedicated Worker (where guest code runs), each step's first zlib call.
// Also the isolate host (`runCode`, same cases) for the other column.
// usage: node --import tsx browser-pins.mjs BUILD REPO
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const [build, repo] = process.argv.slice(2);
const req = createRequire(join(repo, 'package.json'));
const entry = join(build, 'pins-entry.ts');
writeFileSync(
  entry,
  `import zlib from ${JSON.stringify(join(repo, 'packages/runtime-js/src/builtins/zlib.ts'))};\n(globalThis as any).riftyZlib = zlib;\n`,
);
await req('esbuild').build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: join(build, 'pins-zlib.js'),
  logLevel: 'error',
  absWorkingDir: repo,
});
const BUNDLE = readFileSync(join(build, 'pins-zlib.js'), 'utf8');
const T = 'the quick brown fox jumps over the lazy dog '.repeat(200);
const bad = Buffer.from(zlib.deflateSync(T));
bad[20] ^= 0x55;
const CASES = `
const z = globalThis.riftyZlib;
const B = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const G2 = B(${JSON.stringify(Buffer.concat([zlib.gzipSync('a'), zlib.gzipSync('b')]).toString('base64'))});
const ZL = B(${JSON.stringify(zlib.deflateSync(T).toString('base64'))});
const BAD = B(${JSON.stringify(bad.toString('base64'))});
const cases = [
  ['1 exceljs: class extends zlib.DeflateRaw, new', () => { class D extends z.DeflateRaw {} return new D(); }],
  ['2 unzipper: zlib.createInflateRaw()', () => z.createInflateRaw()],
  ['3w pngjs write: zlib.deflateSync', () => z.deflateSync(new Uint8Array(10))],
  ['3r pngjs read: zlib.Inflate.call(this)', () => { function I(o) { z.Inflate.call(this, o); } Object.setPrototypeOf(I.prototype, z.Inflate.prototype); return new I({}); }],
  ['4 pdfkit: zlib.deflateSync', () => z.deflateSync(new Uint8Array(10))],
  ['5a zlib.gunzipSync (2 members)', () => z.gunzipSync(G2)],
  ['5b zlib.unzip(cb)', () => new Promise((res, rej) => z.unzip(ZL, (e, r) => (e ? rej(e) : res(r))))],
  ['6 ws: zlib.createDeflateRaw()', () => z.createDeflateRaw()],
  ['7a zlib.crc32', () => z.crc32('hello')],
  ['7b zlib.inflate(cb) corrupt', () => new Promise((res, rej) => z.inflate(BAD, (e, r) => (e ? rej(e) : res(r))))],
];
const out = [];
for (const [name, f] of cases) {
  try { const r = await f(); out.push([name, 'ok ' + (r && r.length !== undefined ? r.length + ' B' : typeof r)]); }
  catch (e) { out.push([name, (e && e.name) + ': ' + String(e && e.message).slice(0, 110) + (e && e.code ? ' [' + e.code + ']' : '')]); }
}
postMessage(out);`;
const { chromium } = req('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(
  ({ bundle, cases }) =>
    new Promise((res) => {
      const w = new Worker(
        URL.createObjectURL(
          new Blob([`${bundle}\n(async () => {${cases}})();`], { type: 'text/javascript' }),
        ),
      );
      w.onmessage = (e) => res(e.data);
      w.onerror = (e) => res([['worker error', e.message]]);
    }),
  { bundle: BUNDLE, cases: CASES },
);
console.log(
  `chromium ${browser.version()}; rifty browser-host zlib.ts (main) in a dedicated Worker`,
);
for (const [n, r] of out) console.log(`${n} | ${r}`);
await browser.close();
const { runCode } = await import(
  pathToFileURL(join(repo, 'packages/isolate-host/src/index.ts')).href
);
const iso = await runCode(
  `globalThis.riftyZlib = require('zlib'); globalThis.postMessage = (o) => { for (const [n, r] of o) console.log(n + ' | ' + r); }; (async () => {${CASES}})();`,
  { timeoutMs: 20000 },
);
console.log(
  `\nisolate host (runCode, main) exit ${iso.exitCode}${iso.stderr ? ` stderr ${iso.stderr.slice(0, 200)}` : ''}`,
);
process.stdout.write(iso.stdout);
process.exit(0);
