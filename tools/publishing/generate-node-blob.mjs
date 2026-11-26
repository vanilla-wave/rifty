// ADR-0578: Node v24.16.0's `internal/webidl`, `internal/blob`, `internal/file` (vendored, pinned) →
// isolate-guest `guest/node-blob/generated/`. Upstream text is not edited: each module runs in its
// CJS wrapper; `require`/`internalBinding` ids and `primordials` names are checked against the
// bindings (`guest/node-blob/bindings.ts`), so a new upstream input is drift, not a silent gap.
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import {
  NODE,
  cliMode,
  emit,
  esbuildVersion,
  loadsOf,
  nodeLicensePart,
  primordialHeaders,
  vendorReader,
} from './node-sources.mjs';

const mode = cliMode(process.argv, 'generate-node-blob.mjs', 'ADR-0578');

const vendor = fileURLToPath(new URL('./node-blob/vendor/', import.meta.url));
const out = fileURLToPath(
  new URL('../../packages/isolate-guest/src/guest/node-blob/generated/', import.meta.url),
);
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

const { vendored, sources, digest } = vendorReader(vendor, PINS, 'ADR-0578');
async function checked(id) {
  const text = await vendored(`lib/${id}.js`);
  const ids = loadsOf(text);
  if (JSON.stringify(ids) !== JSON.stringify(IMPORTS[id]))
    throw new Error(`node-blob anchor drift: ${id} loads ${ids.join(', ')}`);
  const blocks = primordialHeaders(text);
  if (blocks.length !== 1 || (text.match(/\bprimordials\b/g) ?? []).length !== 1)
    throw new Error(`node-blob anchor drift: ${id} reads primordials outside its one header`);
  for (const name of blocks[0])
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
return { Blob: loaded['internal/blob'].Blob, File: loaded['internal/file'].File, webidl: loaded['internal/webidl'] };
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
const nodeLicense = nodeLicensePart(license);
const sha = digest();
const files = {
  'node-blob.js': `// Generated by tools/publishing/generate-node-blob.mjs; do not edit. ADR-0578.\n// Node ${NODE} lib/internal/{webidl,blob,file}.js; sources sha256 ${sha}; esbuild ${esbuildVersion}. MIT, node.LICENSE.\n${compiled.code}`,
  'node.LICENSE': `${nodeLicense.trimEnd()}\n`,
  'sources.json': `${JSON.stringify({ node: NODE, esbuild: esbuildVersion, sha256: sha, sources }, null, 2)}\n`,
};
await emit(mode, out, files, 'node-blob', 'pnpm node-blob:generate');
console.log(
  `node-blob ${mode}: Node ${NODE}, ${Buffer.byteLength(files['node-blob.js'])} bytes, ${sha}`,
);
