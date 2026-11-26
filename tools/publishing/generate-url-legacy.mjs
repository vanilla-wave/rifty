// ADR-0574: Node v24.16.0's legacy `url` and `querystring` (vendored, pinned) → runtime-js
// `builtins/url-legacy/generated/`. Upstream text is not edited: each module runs in its CJS
// wrapper; `require`/`internalBinding` ids and `primordials` names are checked against the
// bindings (`builtins/url-legacy/bindings.ts`); `internal/url` contributes only its protocol sets.
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

const mode = cliMode(process.argv, 'generate-url-legacy.mjs', 'ADR-0574');

const vendor = fileURLToPath(new URL('./node-url-legacy/vendor/', import.meta.url));
const out = fileURLToPath(
  new URL('../../packages/runtime-js/src/builtins/url-legacy/generated/', import.meta.url),
);
const PINS = {
  'lib/url.js': '0a53e0c4e8bfb5946380577bf9d5ae9c227ad54ae738f5bd5e4a5e8682921f38',
  'lib/querystring.js': '513ace4440c97fcaf3da958598be85f136eb044c6045b06dcac945395c4a7b56',
  'lib/internal/querystring.js': '92d0cbd561d7cce93936b083d56d2a41063d177f3aa6772ae2c1871f160163d1',
  'lib/internal/constants.js': '8c4c12bb17f4b106760be5fe77e8d7febc9b104d9dcd97402c332f64d6619440',
  'lib/internal/url.js': '35896c160c4b0b8b8b47c4382c13d475350d26554e2f403c224e2b0e99e984a7',
  LICENSE: '4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18',
};
/** Module → the exact ids it may load; anything else is drift (a new upstream input). */
const IMPORTS = {
  'internal/constants': [],
  'internal/querystring': ["require('internal/errors')"],
  querystring: ["require('buffer')", "require('internal/querystring')"],
  url: [
    "internalBinding('encoding_binding')",
    "internalBinding('url')",
    "internalBinding('url_pattern')",
    "internalBinding('util')",
    "require('internal/constants')",
    "require('internal/errors')",
    "require('internal/querystring')",
    "require('internal/url')",
    "require('internal/util')",
    "require('internal/validators')",
    "require('querystring')",
  ],
};
/** `primordials` the bindings provide (bindings.ts `primordials`). */
const PRIMORDIALS = new Set([
  'Array',
  'ArrayIsArray',
  'ArrayPrototypeJoin',
  'Boolean',
  'Int8Array',
  'MathAbs',
  'NumberIsFinite',
  'NumberPrototypeToString',
  'ObjectAssign',
  'ObjectKeys',
  'SafeSet',
  'String',
  'StringPrototypeAt',
  'StringPrototypeCharCodeAt',
  'StringPrototypeIndexOf',
  'StringPrototypeReplaceAll',
  'StringPrototypeSlice',
  'StringPrototypeToUpperCase',
  'decodeURIComponent',
]);

const { vendored, sources, digest } = vendorReader(vendor, PINS, 'ADR-0574');
function checked(id, text) {
  const ids = loadsOf(text);
  if (JSON.stringify(ids) !== JSON.stringify(IMPORTS[id]))
    throw new Error(`url-legacy anchor drift: ${id} loads ${ids.join(', ')}`);
  for (const names of primordialHeaders(text))
    for (const name of names)
      if (!PRIMORDIALS.has(name)) throw new Error(`url-legacy primordial drift: ${id} ${name}`);
  return text;
}
function once(text, pattern, what) {
  const found = text.match(pattern);
  if (found === null || text.split(found[0]).length !== 2)
    throw new Error(`url-legacy anchor drift: ${what}`);
  return found[0];
}

const internalUrl = await vendored('lib/internal/url.js');
const sets = ['unsafeProtocol', 'hostlessProtocol', 'slashedProtocol'].map((name) =>
  once(internalUrl, new RegExp(`^const ${name} = new SafeSet\\(\\[[^\\]]*\\]\\);$`, 'm'), name),
);
const modules = [
  [
    'internal/constants',
    checked('internal/constants', await vendored('lib/internal/constants.js')),
  ],
  [
    'internal/querystring',
    checked('internal/querystring', await vendored('lib/internal/querystring.js')),
  ],
  ['querystring', checked('querystring', await vendored('lib/querystring.js'))],
  [
    'internal/url',
    `'use strict';\nconst { SafeSet } = primordials;\n${sets.join('\n')}\nmodule.exports = { ...bind('internal/url'), unsafeProtocol, hostlessProtocol, slashedProtocol };\n`,
  ],
  ['url', checked('url', await vendored('lib/url.js'))],
];
const body = modules
  .map(
    ([id, text]) =>
      `loaded[${JSON.stringify(id)}] = (function (exports, require, module) {\n${text}\nreturn module.exports;\n})(...cjs());`,
  )
  .join('\n');
const compiled = await transform(
  `export default function createUrlLegacy(primordials, internalBinding, bind, process) {
const loaded = Object.create(null);
const load = (id) => (id in loaded ? loaded[id] : bind(id));
const cjs = () => { const module = { exports: {} }; return [module.exports, load, module]; };
${body}
return { url: loaded.url, querystring: loaded.querystring };
}`,
  { format: 'esm', target: 'es2022', minify: true, keepNames: true, legalComments: 'none' },
);
const license = await vendored('LICENSE');
const nodeLicense = nodeLicensePart(license);
const ada = once(
  license,
  /^- ada, located at deps\/ada, is licensed as follows:\n {2}"""[\s\S]*?\n {2}"""$/m,
  'ada license',
);
const sha = digest();
const files = {
  'legacy.js': `// Generated by tools/publishing/generate-url-legacy.mjs; do not edit. ADR-0574.\n// Node ${NODE} lib/url.js, lib/querystring.js, lib/internal/{querystring,constants}.js, internal/url protocol sets; sources sha256 ${sha}; esbuild ${esbuildVersion}. MIT, node.LICENSE.\n${compiled.code}`,
  'node.LICENSE': `${nodeLicense.trimEnd()}\n\n${ada}\n`,
  'sources.json': `${JSON.stringify({ node: NODE, esbuild: esbuildVersion, sha256: sha, sources }, null, 2)}\n`,
};
await emit(mode, out, files, 'url-legacy', 'pnpm url-legacy:generate');
console.log(
  `url-legacy ${mode}: Node ${NODE}, ${Buffer.byteLength(files['legacy.js'])} bytes, ${sha}`,
);
