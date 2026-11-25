// ADR-0577: the isolate guest's TextDecoder/TextEncoder sources →
//   packages/isolate-guest/src/guest/node-encoding/generated/  Node v24.16.0 lib/internal/encoding.js,
//     encoding/single-byte.js, encoding/util.js (vendored, pinned), one anchored edit (line 37: the
//     single-byte require made lazy); requires/bindings/primordials checked against node-encoding.ts;
//   packages/isolate-guest/src/guest/exodus-bytes/generated/  @exodus/bytes 1.16.0 `TextDecoder`
//     (utf-16le/be, gb18030), multi-byte tables trimmed to gb18030, `globalThis` → an empty object
//     (the engine reads no guest global: pure-JS path), evaluated on the first call of its factory.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion, transform } from 'esbuild';
import { bundleViolations } from '../checks/es-floor.mjs';

const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3)
  throw new Error('Usage: generate-node-encoding.mjs --write|--check');
const require = createRequire(import.meta.url);
const EXODUS = '@exodus/bytes';
// Its `exports` has no `./package.json`: the root holds `index.js`.
const exodusRoot = dirname(require.resolve(EXODUS));
const exodusVersion = JSON.parse(await readFile(join(exodusRoot, 'package.json'), 'utf8')).version;
if (esbuildVersion !== '0.28.0' || exodusVersion !== '1.16.0')
  throw new Error('esbuild/@exodus/bytes drift: re-probe ADR-0577');

const vendor = fileURLToPath(new URL('./node-encoding/vendor/', import.meta.url));
const guest = fileURLToPath(new URL('../../packages/isolate-guest/src/guest/', import.meta.url));
const NODE = 'v24.16.0';
const PINS = {
  'lib/internal/encoding.js': '569b962eccc86b00a2948e452a324f5db1c01a15ef8a9164ec11c1005819ed70',
  'lib/internal/encoding/single-byte.js':
    '0823a43fec61145a5f5f96d1e5ec532a1720d6ef7fe147361221ec232905859b',
  'lib/internal/encoding/util.js':
    'd2b4b86ac88c150a3cd099419287381f3efffd5650de553ec0e2637eb98b9b07',
  LICENSE: '4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18',
};
/** Module → the exact ids it may load (node-encoding.ts `bind`/`internalBinding`); else drift. */
const IMPORTS = {
  'internal/encoding': [
    "internalBinding('config')",
    "internalBinding('encoding_binding')",
    "internalBinding('icu')",
    "require('internal/buffer')",
    "require('internal/encoding/single-byte')",
    "require('internal/encoding/util')",
    "require('internal/errors')",
    "require('internal/util')",
    "require('internal/util/inspect')",
    "require('internal/util/types')",
    "require('internal/validators')",
    "require('string_decoder')",
  ],
  'internal/encoding/single-byte': [
    "require('buffer')",
    "require('internal/buffer')",
    "require('internal/errors')",
  ],
  'internal/encoding/util': [],
};
/** `primordials` node-encoding.ts provides. */
const PRIMORDIALS = new Set([
  'Array',
  'ArrayPrototypeFill',
  'Boolean',
  'ObjectDefineProperties',
  'ObjectGetOwnPropertyDescriptors',
  'ObjectKeys',
  'ObjectPrototypeHasOwnProperty',
  'ObjectSetPrototypeOf',
  'ObjectValues',
  'SafeArrayIterator',
  'SafeMap',
  'SafeSet',
  'StringPrototypeIncludes',
  'StringPrototypeSlice',
  'Symbol',
  'SymbolToStringTag',
  'TypedArrayFrom',
  'TypedArrayOf',
  'TypedArrayPrototypeIncludes',
  'TypedArrayPrototypeSet',
  'Uint16Array',
  'Uint8Array',
]);
/** The one declared edit (ADR-0577): `single-byte.js` evaluates on first use, not at load. */
const LAZY_LINE = 37;
const LAZY_ANCHOR =
  "const { isSinglebyteEncoding, createSinglebyteDecoder } = require('internal/encoding/single-byte');";
const LAZY_EDIT =
  "let lazySingleByte; const singleByte = () => (lazySingleByte ??= require('internal/encoding/single-byte')); const isSinglebyteEncoding = (enc) => singleByte().isSinglebyteEncoding(enc); const createSinglebyteDecoder = (enc, fatal) => singleByte().createSinglebyteDecoder(enc, fatal);";

const sources = {};
async function vendored(path) {
  const text = await readFile(join(vendor, path), 'utf8');
  const sha = createHash('sha256').update(text).digest('hex');
  if (sha !== PINS[path]) throw new Error(`Node source drift: ${path} (${sha}); re-probe ADR-0577`);
  sources[path] = sha;
  return text;
}
function checked(id, text) {
  const ids = [...new Set(text.match(/\b(?:require|internalBinding)\('[^']+'\)/g) ?? [])].sort();
  if (JSON.stringify(ids) !== JSON.stringify(IMPORTS[id]))
    throw new Error(`node-encoding anchor drift: ${id} loads ${ids.join(', ')}`);
  for (const block of text.matchAll(/const \{([^}]*)\} = primordials;/g))
    for (const name of block[1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean))
      if (!PRIMORDIALS.has(name)) throw new Error(`node-encoding primordial drift: ${id} ${name}`);
  return text;
}

const encodingJs = checked('internal/encoding', await vendored('lib/internal/encoding.js'));
if (
  encodingJs.split('\n')[LAZY_LINE - 1] !== LAZY_ANCHOR ||
  encodingJs.split(LAZY_ANCHOR).length !== 2
)
  throw new Error(`node-encoding anchor drift: encoding.js:${LAZY_LINE} single-byte require`);
const modules = [
  ['internal/encoding', encodingJs.replace(LAZY_ANCHOR, LAZY_EDIT)],
  [
    'internal/encoding/single-byte',
    checked(
      'internal/encoding/single-byte',
      await vendored('lib/internal/encoding/single-byte.js'),
    ),
  ],
  [
    'internal/encoding/util',
    checked('internal/encoding/util', await vendored('lib/internal/encoding/util.js')),
  ],
];
const defs = modules
  .map(
    ([id, text]) =>
      `defs[${JSON.stringify(id)}] = function (exports, require, module) {\n${text}\n};`,
  )
  .join('\n');
const compiled = await transform(
  `export default function createNodeEncoding(primordials, internalBinding, bind) {
const defs = Object.create(null);
${defs}
const loaded = Object.create(null);
function load(id) {
  const def = defs[id];
  if (def === undefined) return bind(id);
  let module = loaded[id];
  if (module === undefined) {
    module = loaded[id] = { exports: {} };
    def(module.exports, load, module);
  }
  return module.exports;
}
return load('internal/encoding');
}`,
  { format: 'esm', target: 'es2022', minify: true, keepNames: true, legalComments: 'none' },
);
const license = await vendored('LICENSE');
const nodeLicense = license.slice(0, license.indexOf('The Node.js license applies to all parts'));
const exodusLicense = await readFile(join(exodusRoot, 'LICENSE'), 'utf8');
const nodeSha = createHash('sha256').update(JSON.stringify(sources)).digest('hex');

// @exodus/bytes: its `TextDecoder` for the three encodings Node decodes through ICU here.
const exodusSources = {};
/** Feature reads of post-ES2022 builtins in the engine → `undefined` (its fallbacks run). */
const POST_FLOOR = [
  'Uint8Array.fromBase64',
  'Uint8Array.fromHex',
  'Uint8Array.prototype.toBase64',
  'Uint8Array.prototype.toHex',
  'String.prototype.isWellFormed',
  'String.prototype.toWellFormed',
];
/**
 * What `define` cannot reach, exact-once anchors: the same reads as destructuring, and the native
 * `toBase64` branches they guard (dead once the reads are `undefined`; the floor check is lexical).
 */
const EDITS = {
  'base64.js': [
    ['const { toBase64: web64 } = Uint8Array.prototype // Modern engines have this\n', ''],
    ['const haveWeb = (x) => web64 && x.toBase64 === web64\n', ''],
    [
      '  if (haveWeb(x)) return padding ? x.toBase64() : x.toBase64({ omitPadding: !padding }) // Modern, optionless is slightly faster\n',
      '',
    ],
    [
      "  if (haveWeb(x)) return x.toBase64({ alphabet: 'base64url', omitPadding: !padding }) // Modern\n",
      '',
    ],
  ],
  'fallback/latin1.js': [
    [
      '  if (\n    useLatin1atob &&\n    total >= 256 &&\n    total < 1e8 &&\n    arr.toBase64 === web64 &&\n    arr.BYTES_PER_ELEMENT === 1\n  ) {\n    const sliced = start === 0 && stop === arr.length ? arr : arr.subarray(start, stop)\n    return atob(sliced.toBase64())\n  }\n',
      '',
    ],
  ],
  'utf8.js': [['const { isWellFormed } = String.prototype', 'const isWellFormed = undefined']],
};
const KEPT_TABLES = (k) => k.startsWith('$') || k === 'gb18030' || k === 'gb18030-ranges';
const exodus = await build({
  stdin: {
    contents: "export { TextDecoder } from '@exodus/bytes/encoding.js';",
    resolveDir: exodusRoot,
    loader: 'js',
  },
  bundle: true,
  write: false,
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: [],
  format: 'iife',
  globalName: 'exodusBytes',
  target: 'es2022',
  minify: true,
  keepNames: true,
  legalComments: 'none',
  // The engine reads no guest global (no guest `Buffer`, `TextDecoder`, `atob`) and no
  // post-ES2022 builtin it feature-detects (ADR-0469 floor): its pure-JS path.
  define: {
    globalThis: 'noGuestGlobals',
    ...Object.fromEntries(POST_FLOOR.map((m) => [m, 'undefined'])),
  },
  plugins: [
    {
      name: 'exodus-pinned-trimmed',
      setup(b) {
        b.onLoad({ filter: /\.(?:c?js|json)$/ }, async ({ path }) => {
          const text = await readFile(path, 'utf8');
          const rel = path.slice(exodusRoot.length + 1);
          exodusSources[rel] = createHash('sha256').update(text).digest('hex');
          if (EDITS[rel]) {
            let out = text;
            for (const [from, to] of EDITS[rel]) {
              if (out.split(from).length !== 2)
                throw new Error(`exodus anchor drift: ${rel}: ${from}`);
              out = out.replace(from, () => to);
            }
            return { contents: out, loader: 'js' };
          }
          if (!rel.endsWith('multi-byte.encodings.json')) return undefined;
          const kept = Object.fromEntries(
            Object.entries(JSON.parse(text)).filter(([k]) => KEPT_TABLES(k)),
          );
          return { contents: JSON.stringify(kept), loader: 'json' };
        });
      },
    },
  ],
});
const exodusCode = exodus.outputFiles[0].text;
if (/\bglobalThis\b/.test(exodusCode)) throw new Error('exodus: a globalThis read survived');
const floor = bundleViolations('exodus-bytes/generated/text-decoder.js', exodusCode);
if (floor.length) throw new Error(`exodus: post-ES2022 builtins survived:\n${floor.join('\n')}`);
// esbuild loads in parallel: sort, so the record is deterministic.
const exodusSorted = Object.fromEntries(
  Object.entries(exodusSources).sort(([a], [b]) => (a < b ? -1 : 1)),
);
const exodusSha = createHash('sha256').update(JSON.stringify(exodusSorted)).digest('hex');
// The engine's own files, pinned like Node's (the lockfile pins the tarball; this, what is bundled).
if (exodusSha !== '35f50135d33d5e46aa0b5a2c06fca9a2fa2a32d68899b5d493c832cbedf41c06')
  throw new Error(`@exodus/bytes source drift (${exodusSha}); re-probe ADR-0577`);

const NODE_OUT = join(guest, 'node-encoding/generated');
const EXODUS_OUT = join(guest, 'exodus-bytes/generated');
const files = {
  [join(NODE_OUT, 'encoding.js')]:
    `// Generated by tools/publishing/generate-node-encoding.mjs; do not edit. ADR-0577.\n// Node ${NODE} lib/internal/encoding.js (edit: line ${LAZY_LINE} lazy single-byte require), lib/internal/encoding/{single-byte,util}.js; sources sha256 ${nodeSha}; esbuild ${esbuildVersion}. MIT, node.LICENSE.\n${compiled.code}`,
  [join(NODE_OUT, 'node.LICENSE')]:
    `${nodeLicense.trimEnd()}\n\n- lib/internal/encoding/single-byte.js and lib/internal/encoding/util.js are from @exodus/bytes:\n  """\n${exodusLicense
      .trimEnd()
      .split('\n')
      .map((l) => (l ? `    ${l}` : ''))
      .join('\n')}\n  """\n`,
  [join(NODE_OUT, 'sources.json')]: `${JSON.stringify(
    { node: NODE, esbuild: esbuildVersion, sha256: nodeSha, sources },
    null,
    2,
  )}\n`,
  [join(EXODUS_OUT, 'text-decoder.js')]:
    `// Generated by tools/publishing/generate-node-encoding.mjs; do not edit. ADR-0577.\n// ${EXODUS} ${exodusVersion} TextDecoder (encoding.js), tables trimmed to gb18030, no guest globals; sources sha256 ${exodusSha}; esbuild ${esbuildVersion}. MIT, exodus.LICENSE.\nexport default function loadExodusTextDecoder() {\nconst noGuestGlobals = {};\n${exodusCode}return exodusBytes.TextDecoder;\n}\n`,
  [join(EXODUS_OUT, 'exodus.LICENSE')]: exodusLicense,
  [join(EXODUS_OUT, 'sources.json')]: `${JSON.stringify(
    { version: exodusVersion, esbuild: esbuildVersion, sha256: exodusSha, sources: exodusSorted },
    null,
    2,
  )}\n`,
};
for (const [path, text] of Object.entries(files)) {
  if (mode === '--write') {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  } else if ((await readFile(path, 'utf8').catch(() => '')) !== text) {
    throw new Error(`node-encoding drift: ${path}; run pnpm node-encoding:generate`);
  }
}
console.log(
  `node-encoding ${mode}: Node ${NODE} ${Buffer.byteLength(files[join(NODE_OUT, 'encoding.js')])} B, ${EXODUS} ${exodusVersion} ${Buffer.byteLength(files[join(EXODUS_OUT, 'text-decoder.js')])} B`,
);
