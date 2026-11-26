// ADR-0578: Node v24.16.0's `internal/webidl`, `internal/blob`, `internal/file` (vendored, pinned) →
// isolate-guest `guest/node-blob/generated/`. Upstream text is not edited: each module runs in its
// CJS wrapper; `require`/`internalBinding` ids and `primordials` names are checked against the
// bindings (`guest/node-blob/bindings.ts`), so a new upstream input is drift, not a silent gap.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { version as esbuildVersion, transform } from 'esbuild';

const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3)
  throw new Error('Usage: generate-node-blob.mjs --write|--check');
if (esbuildVersion !== '0.28.0') throw new Error('esbuild drift: re-probe ADR-0578');

const vendor = fileURLToPath(new URL('./node-blob/vendor/', import.meta.url));
const out = fileURLToPath(
  new URL('../../packages/isolate-guest/src/guest/node-blob/generated/', import.meta.url),
);
const NODE = 'v24.16.0';
const PINS = {
  'lib/internal/webidl.js': 'ade772548eef5a10c1a82bcac554b482f4ebc3f31accd3fb8d89bfafcb8d48a2',
  'lib/internal/blob.js': '547deb661f508360bd5ce294d28e882a1ce5db14e831dacdbd4bde067135e6c1',
  'lib/internal/file.js': 'a6935dd6037ce604b5075c3f7dbe98000ae2d65e6fa589af36267ff40f0cdd09',
  LICENSE: '4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18',
};
/** Module → the exact ids it may load; anything else is drift (a new upstream input). */
const IMPORTS = {
  'internal/webidl': [
    "require('internal/errors')",
    "require('internal/util')",
    "require('internal/util/types')",
  ],
  'internal/blob': [
    "internalBinding('blob')",
    "internalBinding('buffer')",
    "require('internal/constants')",
    "require('internal/encoding')",
    "require('internal/errors')",
    "require('internal/process/task_queues')",
    "require('internal/url')",
    "require('internal/util')",
    "require('internal/util/inspect')",
    "require('internal/util/types')",
    "require('internal/validators')",
    "require('internal/webidl')",
    "require('internal/webstreams/readablestream')",
    "require('internal/worker/js_transferable')",
    "require('timers')",
  ],
  'internal/file': [
    "require('internal/blob')",
    "require('internal/errors')",
    "require('internal/util')",
    "require('internal/util/inspect')",
    "require('internal/worker/js_transferable')",
  ],
};
/** `primordials` the bindings provide (bindings.ts `primordials`). */
const PRIMORDIALS = new Set([
  'ArrayBufferIsView',
  'ArrayBufferPrototypeGetByteLength',
  'ArrayPrototypePush',
  'ArrayPrototypeToSorted',
  'DataViewPrototypeGetBuffer',
  'DateNow',
  'FunctionPrototypeCall',
  'MathAbs',
  'MathMax',
  'MathMin',
  'MathPow',
  'MathSign',
  'MathTrunc',
  'NumberIsNaN',
  'NumberMAX_SAFE_INTEGER',
  'NumberMIN_SAFE_INTEGER',
  'ObjectAssign',
  'ObjectDefineProperties',
  'ObjectDefineProperty',
  'ObjectPrototypeIsPrototypeOf',
  'ObjectSetPrototypeOf',
  'PromisePrototypeThen',
  'PromiseReject',
  'PromiseWithResolvers',
  'RegExpPrototypeExec',
  'RegExpPrototypeSymbolReplace',
  'SafeSet',
  'String',
  'StringPrototypeSplit',
  'StringPrototypeToLowerCase',
  'StringPrototypeToWellFormed',
  'Symbol',
  'SymbolIterator',
  'SymbolToStringTag',
  'TypeError',
  'TypedArrayPrototypeGetBuffer',
  'Uint8Array',
]);

const sources = {};
async function vendored(path) {
  const text = await readFile(join(vendor, path), 'utf8');
  const sha = createHash('sha256').update(text).digest('hex');
  if (sha !== PINS[path]) throw new Error(`Node source drift: ${path} (${sha}); re-probe ADR-0578`);
  sources[path] = sha;
  return text;
}
async function checked(id) {
  const text = await vendored(`lib/${id}.js`);
  const ids = [...new Set(text.match(/\b(?:require|internalBinding)\('[^']+'\)/g) ?? [])].sort();
  if (JSON.stringify(ids) !== JSON.stringify(IMPORTS[id]))
    throw new Error(`node-blob anchor drift: ${id} loads ${ids.join(', ')}`);
  const blocks = [...text.matchAll(/const \{([^}]*)\} = primordials;/g)];
  if (blocks.length !== 1 || (text.match(/\bprimordials\b/g) ?? []).length !== 1)
    throw new Error(`node-blob anchor drift: ${id} reads primordials outside its one header`);
  for (const name of blocks[0][1]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean))
    if (!PRIMORDIALS.has(name)) throw new Error(`node-blob primordial drift: ${id} ${name}`);
  return [id, text];
}

const modules = [
  await checked('internal/webidl'),
  await checked('internal/blob'),
  await checked('internal/file'),
];
const body = modules
  .map(
    ([id, text]) =>
      `loaded[${JSON.stringify(id)}] = (function (exports, require, module) {\n${text}\nreturn module.exports;\n})(...cjs());`,
  )
  .join('\n');
const compiled = await transform(
  `export default function createNodeBlob(primordials, internalBinding, bind) {
const loaded = Object.create(null);
const load = (id) => (id in loaded ? loaded[id] : bind(id));
const cjs = () => { const module = { exports: {} }; return [module.exports, load, module]; };
${body}
return { Blob: loaded['internal/blob'].Blob, File: loaded['internal/file'].File };
}`,
  // Identifiers kept: V8 names a class by its source name (`Class constructor Blob cannot be invoked without 'new'`).
  {
    format: 'esm',
    target: 'es2022',
    minifyWhitespace: true,
    minifySyntax: true,
    legalComments: 'none',
  },
);
const license = await vendored('LICENSE');
const nodeLicense = license.slice(0, license.indexOf('The Node.js license applies to all parts'));
const sha = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
const files = {
  'node-blob.js': `// Generated by tools/publishing/generate-node-blob.mjs; do not edit. ADR-0578.\n// Node ${NODE} lib/internal/{webidl,blob,file}.js; sources sha256 ${sha}; esbuild ${esbuildVersion}. MIT, node.LICENSE.\n${compiled.code}`,
  'node.LICENSE': `${nodeLicense.trimEnd()}\n`,
  'sources.json': `${JSON.stringify({ node: NODE, esbuild: esbuildVersion, sha256: sha, sources }, null, 2)}\n`,
};
for (const [name, text] of Object.entries(files)) {
  if (mode === '--write') {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, name), text);
  } else if ((await readFile(join(out, name), 'utf8').catch(() => '')) !== text) {
    throw new Error(`node-blob drift: ${name}; run pnpm node-blob:generate`);
  }
}
console.log(
  `node-blob ${mode}: Node ${NODE}, ${Buffer.byteLength(files['node-blob.js'])} bytes, ${sha}`,
);
