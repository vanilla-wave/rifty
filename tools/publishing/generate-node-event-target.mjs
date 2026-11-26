// ADR-0579: Node v24.16.0's `internal/event_target`, `internal/abort_controller` (vendored, pinned) →
// isolate-guest `guest/node-event-target/generated/`. Upstream text is not edited: each module is the
// body of Node's builtin wrapper; `require`/`internalBinding` ids and `primordials` names are checked
// against the bindings (`guest/node-event-target/bindings.ts`), so a new upstream input is drift.
// `internal/webidl` is node-blob's (one copy, ADR-0578), bound at creation.
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

const mode = cliMode(process.argv, 'generate-node-event-target.mjs', 'ADR-0579');
const vendor = fileURLToPath(new URL('./node-event-target/vendor/', import.meta.url));
const blobVendor = fileURLToPath(new URL('./node-blob/vendor/', import.meta.url));
const out = fileURLToPath(
  new URL('../../packages/isolate-guest/src/guest/node-event-target/generated/', import.meta.url),
);
const PINS = {
  'lib/internal/event_target.js':
    'f5817a1875e4ddc8772e888c6a5c59aa74ed01f58e78096e0e36b780d604004c',
  'lib/internal/abort_controller.js':
    '3302a512a8882723e4cb756113ed53f2f24216d1a16c187d33e3ba663f236cbc',
};
const LICENSE_PIN = { LICENSE: '4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18' };
/** Module → the exact ids it may load; anything else is drift (a new upstream input). */
const IMPORTS = {
  'internal/event_target': [
    "require('events')",
    "require('internal/errors')",
    "require('internal/perf/utils')",
    "require('internal/util')",
    "require('internal/validators')",
    "require('internal/webidl')",
    "require('util')",
  ],
  'internal/abort_controller': [
    "internalBinding('messaging')",
    "require('events')",
    "require('internal/assert')",
    "require('internal/errors')",
    "require('internal/event_target')",
    "require('internal/util')",
    "require('internal/util/inspect')",
    "require('internal/validators')",
    "require('internal/webidl')",
    "require('internal/worker/io')",
    "require('internal/worker/js_transferable')",
    "require('timers')",
  ],
};
/** `primordials` the bindings provide (bindings.ts `primordials`). */
const PRIMORDIALS = new Set([
  'ArrayFrom',
  'ArrayPrototypePush',
  'ArrayPrototypeReduce',
  'Boolean',
  'Error',
  'FunctionPrototypeCall',
  'NumberIsInteger',
  'ObjectAssign',
  'ObjectDefineProperties',
  'ObjectDefineProperty',
  'ObjectGetOwnPropertyDescriptor',
  'ObjectSetPrototypeOf',
  'PromiseResolve',
  'PromiseWithResolvers',
  'ReflectApply',
  'SafeFinalizationRegistry',
  'SafeMap',
  'SafeSet',
  'SafeWeakMap',
  'SafeWeakRef',
  'SafeWeakSet',
  'String',
  'Symbol',
  'SymbolFor',
  'SymbolToStringTag',
]);

const { vendored, sources, digest } = vendorReader(vendor, PINS, 'ADR-0579');
async function checked(id) {
  const text = await vendored(`lib/${id}.js`);
  const ids = loadsOf(text);
  if (JSON.stringify(ids) !== JSON.stringify(IMPORTS[id]))
    throw new Error(`node-event-target anchor drift: ${id} loads ${ids.join(', ')}`);
  const blocks = primordialHeaders(text);
  if (blocks.length !== 1 || (text.match(/\bprimordials\b/g) ?? []).length !== 1)
    throw new Error(
      `node-event-target anchor drift: ${id} reads primordials outside its one header`,
    );
  for (const name of blocks[0])
    if (!PRIMORDIALS.has(name))
      throw new Error(`node-event-target primordial drift: ${id} ${name}`);
  return [id, text];
}

const modules = [
  await checked('internal/event_target'),
  await checked('internal/abort_controller'),
];
const defs = modules
  .map(
    ([id, text]) =>
      `${JSON.stringify(id)}: function (exports, require, module, process, internalBinding, primordials) {\n${text}\n}`,
  )
  .join(',\n');
// Node's builtin loader: cache before run, plain call (`this` undefined).
const compiled = await transform(
  `export default function createNodeEventTarget(primordials, internalBinding, bind, process) {
const defs = { __proto__: null,
${defs}
};
const cache = { __proto__: null };
function load(id) {
  const cached = cache[id];
  if (cached !== undefined) return cached.exports;
  const def = defs[id];
  if (def === undefined) return bind(id);
  const module = { exports: {} };
  cache[id] = module;
  def(module.exports, load, module, process, internalBinding, primordials);
  return module.exports;
}
return { eventTarget: load('internal/event_target'), abortController: load('internal/abort_controller') };
}`,
  // Identifiers kept: V8 names a class by its source name (`Class constructor EventTarget cannot be invoked without 'new'`).
  {
    format: 'esm',
    target: 'es2022',
    minifyWhitespace: true,
    minifySyntax: true,
    legalComments: 'none',
  },
);
const license = await vendorReader(blobVendor, LICENSE_PIN, 'ADR-0579').vendored('LICENSE');
const sha = digest();
const files = {
  'node-event-target.js': `// Generated by tools/publishing/generate-node-event-target.mjs; do not edit. ADR-0579.\n// Node ${NODE} lib/internal/{event_target,abort_controller}.js; sources sha256 ${sha}; esbuild ${esbuildVersion}. MIT, node.LICENSE.\n${compiled.code}`,
  'node.LICENSE': `${nodeLicensePart(license).trimEnd()}\n`,
  'sources.json': `${JSON.stringify({ node: NODE, esbuild: esbuildVersion, sha256: sha, sources }, null, 2)}\n`,
};
await emit(mode, out, files, 'node-event-target', 'pnpm node-event-target:generate');
console.log(
  `node-event-target ${mode}: Node ${NODE}, ${Buffer.byteLength(files['node-event-target.js'])} bytes, ${sha}`,
);
