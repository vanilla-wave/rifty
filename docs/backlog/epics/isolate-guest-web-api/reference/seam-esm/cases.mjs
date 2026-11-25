// Cases for run.mjs. Paths are relative to /workspace (the node oracle: its temp dir).
const T = `const t = (label, fn) => { try { const v = fn(); console.log(label + ': ' + (typeof v === 'string' ? v : JSON.stringify(v))); } catch (e) { console.log(label + ': ERR ' + (e && e.name) + ' ' + (e && e.code) + ' ' + String(e && e.message).split('\\n')[0]); } };
const ta = async (label, fn) => { try { const v = await fn(); console.log(label + ': ' + (typeof v === 'string' ? v : JSON.stringify(v))); } catch (e) { console.log(label + ': ERR ' + (e && e.name) + ' ' + (e && e.code) + ' ' + String(e && e.message).split('\\n')[0]); } };
`;
const DEPS = {
  'm.mjs': "export const x = 'mjs-x';\nexport default 'mjs-default';\n",
  'c.cjs': 'exports.a = 1;\nexports.b = 2;\n',
  'x.txt': 'xtext',
  'data.json': '{"k":"v"}',
};
const cjs = (name, group, body, extra = {}) => ({
  name,
  group,
  entry: 'main.cjs',
  files: { ...DEPS, ...extra, 'main.cjs': `${T}(async () => {\n${body}\n})();\n` },
});
const esm = (name, group, entry, files) => ({ name, group, entry, files: { ...DEPS, ...files } });

export const CASES = [
  // --- seam: the URL rows of runtime-js/isolate-web-globals-captured-at-load ---
  cjs(
    'url-globals',
    'seam',
    `t('typeof URL', () => typeof URL); t('URL.canParse', () => typeof URL.canParse); t('new URL', () => new URL('../b?c=1#d', 'http://u:p@a.com:8/x/y').href); t('USP', () => new URLSearchParams('a=1&b=2&a=3').getAll('a'));`,
  ),
  cjs(
    'import-file-url-mjs',
    'seam',
    `await ta('import(file:m.mjs)', async () => Object.keys(await import('file://' + __dirname + '/m.mjs')));`,
  ),
  cjs(
    'import-file-url-cjs',
    'seam',
    `await ta('import(file:c.cjs)', async () => (await import('file://' + __dirname + '/c.cjs')).default);`,
  ),
  cjs(
    'create-require-file-url',
    'seam',
    `t('createRequire(file:)', () => require('module').createRequire('file://' + __filename)('./c.cjs'));`,
  ),
  cjs(
    'path-file-url',
    'seam',
    `const url = require('url'); t('pathToFileURL', () => url.pathToFileURL('/x y').href); t('fileURLToPath', () => url.fileURLToPath('file:///x%20y')); t('fileURLToPath(URL)', () => url.fileURLToPath(new URL('file:///a/b')));`,
  ),
  cjs(
    'url-module-URL',
    'seam',
    `const url = require('url'); t('new url.URL', () => new url.URL('file:///x').href); t('url.URL === URL', () => url.URL === URL); t('new url.USP', () => new url.URLSearchParams('a=1').get('a')); t('url.USP === USP', () => url.URLSearchParams === URLSearchParams);`,
  ),
  cjs(
    'fs-path-arg',
    'seam',
    `const fs = require('fs'); t('readFileSync({})', () => fs.readFileSync({})); t('readFileSync(URL)', () => fs.readFileSync(new URL('file://' + __dirname + '/x.txt'), 'utf8'));`,
  ),
  cjs(
    'url-legacy',
    'seam',
    `const url = require('url'); t('resolve 1', () => url.resolve('https://example.com/a', 'b')); t('resolve 2', () => url.resolve('http://a.com/b/c', '../d')); t('parse', () => { const p = url.parse('http://u:p@a.com:8/b?c=d#e'); return [p.auth, p.host, p.hostname, p.port, p.path, p.href]; });`,
  ),
  // --- remaining ceilings: captured at load, or detection with a fallback ---
  cjs(
    'blob-file',
    'ceiling',
    `const b = require('buffer'); t('typeof Blob', () => typeof Blob); t('new buffer.Blob', () => new b.Blob(['a']).size); t('instanceof buffer.File', () => ({}) instanceof b.File); t('buffer.Blob === Blob', () => b.Blob === Blob);`,
  ),
  cjs(
    'crypto-subtle',
    'ceiling',
    `const c = require('crypto'); t('typeof crypto.subtle.digest', () => typeof c.subtle.digest); t('webcrypto.subtle', () => typeof c.webcrypto.subtle); t('globalThis.crypto.subtle', () => typeof globalThis.crypto.subtle);`,
  ),
  cjs(
    'stream-web',
    'ceiling',
    `const sw = require('stream/web'); t('stream/web.ReadableStream', () => typeof sw.ReadableStream); t('=== global', () => sw.ReadableStream === globalThis.ReadableStream); t('new sw.ReadableStream', () => typeof new sw.ReadableStream().getReader);`,
  ),
  cjs(
    'abort-event',
    'ceiling',
    `t('new AbortController', () => typeof new AbortController().signal); t('events.once', () => typeof require('events').once); t('new EventEmitter', () => typeof new (require('events'))().on); t('util.types', () => require('util').types.isPromise(Promise.resolve()));`,
  ),
  // --- smoke: what a load-time detection could reroute ---
  {
    name: 'smoke',
    group: 'smoke',
    entry: 'main.cjs',
    files: {
      ...DEPS,
      'main.cjs': `${T}const fs = require('fs');
console.log('hello');
t('require json', () => require('./data.json'));
fs.writeFileSync('out.txt', 'written'); t('fs write/read', () => fs.readFileSync('out.txt', 'utf8'));
setTimeout(() => console.log('timer'), 5);
setImmediate(() => console.log('immediate'));
Promise.resolve().then(() => console.log('micro'));
fs.createReadStream('x.txt').on('data', (d) => console.log('stream', String(d))).on('error', (e) => console.log('stream ERR', e.message));
fs.promises.readFile('x.txt', 'utf8').then((s) => console.log('promises', s));
t('TextDecoder', () => new TextDecoder().decode(new Uint8Array([104, 105])));
t('Buffer', () => Buffer.from('hi').toString('base64'));
t('util.inspect', () => require('util').inspect({ a: [1, { b: 2 }] }));
`,
    },
  },
  // --- ESM (meaningful on url-esm; the rest show today's gap) ---
  esm('esm-entry-mjs', 'esm', 'main.mjs', {
    'main.mjs': `import fs, { readFileSync } from 'node:fs';
import { x } from './m.mjs';
import def from './m.mjs';
console.log(x, def, typeof fs.readFileSync, readFileSync === fs.readFileSync);
console.log(import.meta.url, import.meta.dirname, import.meta.filename);
console.log(typeof import.meta.resolve, import.meta.resolve('./m.mjs'));
`,
  }),
  esm('esm-type-module', 'esm', 'pkg/main.js', {
    'pkg/package.json': '{"type":"module"}',
    'pkg/main.js':
      "import { x } from '../m.mjs';\nconsole.log('type-module', x, typeof require);\n",
  }),
  esm('esm-typeless-js', 'esm', 'typeless.js', {
    'typeless.js': "import fs from 'fs';\nconsole.log('typeless', typeof fs.readFileSync);\n",
  }),
  esm('esm-import-cjs', 'esm', 'main.mjs', {
    'main.mjs':
      "import def, { a, b } from './c.cjs';\nimport * as ns from './c.cjs';\nconsole.log(JSON.stringify(def), a, b, Object.keys(ns).sort().join());\n",
  }),
  esm('esm-dynamic-import', 'esm', 'main.mjs', {
    'main.mjs':
      "const c = await import('./c.cjs');\nconst m = await import('./m.mjs');\nconst f = await import('node:fs');\nconsole.log(c.a, m.x, typeof f.default.readFileSync);\n",
  }),
  cjs(
    'cjs-dynamic-import',
    'esm',
    `await ta('import(./m.mjs)', async () => (await import('./m.mjs')).x); await ta('import(./c.cjs)', async () => (await import('./c.cjs')).a);`,
  ),
  esm('esm-tla', 'esm', 'main.mjs', {
    'main.mjs': "await new Promise((r) => setTimeout(r, 10));\nconsole.log('tla done');\n",
  }),
  cjs(
    'require-esm',
    'esm',
    `t('require_module', () => process.features.require_module); t('require(m.mjs)', () => require('./m.mjs').x);`,
  ),
  esm('esm-create-require', 'esm', 'main.mjs', {
    'main.mjs':
      "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nconsole.log(require('./c.cjs').a, require('./data.json').k);\n",
  }),
  esm('esm-json-import', 'esm', 'main.mjs', {
    'main.mjs': "import data from './data.json' with { type: 'json' };\nconsole.log(data.k);\n",
  }),
  {
    ...esm('esm-nanoid', 'esm', 'main.mjs', {
      'main.mjs':
        "import { nanoid, customAlphabet } from 'nanoid';\nconsole.log(nanoid().length, customAlphabet('ab', 5)().length);\n",
    }),
    needsNanoid: true,
  },
  {
    ...cjs(
      'cjs-import-nanoid',
      'esm',
      `await ta('import(nanoid)', async () => (await import('nanoid')).nanoid().length); t('require(nanoid)', () => require('nanoid').nanoid().length);`,
    ),
    needsNanoid: true,
  },
  // nanoid's stop, minimised: an imported binding at the start of a line after an expression
  // statement without a semicolon (ASI).
  esm('esm-asi-imported-binding', 'esm', 'main.mjs', {
    'main.mjs':
      "import { webcrypto as crypto } from 'node:crypto'\nimport { x } from './m.mjs'\nlet a\na = String(1)\ncrypto.getRandomValues(new Uint8Array(1))\nlet b\nb = String(2)\nx.length\nconsole.log('asi ok', a, b)\n",
  }),
  esm('esm-throw', 'esm', 'main.mjs', {
    'main.mjs': "import { x } from './m.mjs';\nconsole.log(x);\nthrow new Error('boom');\n",
  }),
  esm('esm-syntax-error', 'esm', 'main.mjs', {
    'main.mjs': "import { x } from './m.mjs';\nconst = 1;\n",
  }),
  esm('esm-missing-export', 'esm', 'main.mjs', {
    'main.mjs': "import { nope } from './m.mjs';\nconsole.log(nope);\n",
  }),
  esm('esm-data-url', 'esm', 'main.mjs', {
    'main.mjs':
      "const m = await import('data:text/javascript,export default 42');\nconsole.log(m.default);\n",
  }),
  {
    name: 'eval-dynamic-import',
    group: 'esm',
    eval: "import('node:fs').then((m) => console.log(typeof m.readFileSync))",
  },
  {
    name: 'eval-esm-syntax',
    group: 'esm',
    eval: "import fs from 'node:fs'; console.log(typeof fs.readFileSync)",
  },
];
