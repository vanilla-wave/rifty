// ADR-0575: Node v24.16.0's stream core and fs streams (vendored, pinned) → io
// `streams/node/generated/`. What it does with the upstream text, and nothing else:
// - whole modules (`stream`, `stream/promises`, `internal/streams/*`, `internal/fs/streams`,
//   `internal/assert`, `internal/events/abort_listener`, `internal/webstreams/adapters`): the file
//   unedited, as the body of Node's builtin wrapper `function (exports, require, module, process,
//   internalBinding, primordials)`;
// - selected modules (`internal/{errors,validators,util,fs/utils,url}`): the top-level statements
//   the other modules read (closure by name; `E()` registrations by error code), each unedited and
//   in upstream order, under a narrowed `const { … } = primordials;` header, the `PRELUDE`
//   requires (narrowed upstream requires) and a `module.exports = { … }` of the names read;
// - every other id: `bind(id)`/`internalBinding(id)`, the bindings (`streams/node/bindings.ts`).
// Checked: sha256 per file; the bound ids and members, the internalBinding ids, the host globals
// read (`EXPECTED`) — a new upstream input is drift, not a silent gap. esbuild then minifies
// whitespace and syntax (identifiers kept: V8's TypeError texts quote them). `buildNodeStreams`
// returns the text before esbuild (`modules`) for the verbatim test.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import {
  NODE,
  cliMode,
  emit,
  esbuildVersion,
  nodeLicensePart,
  vendorReader,
} from './node-sources.mjs';

// acorn: runtime-js's own dependency, not a root one (a root `node_modules/acorn` changes the
// playground bundle's CJS interop, measured 2026-11-26). Pinned: its AST is the slicer's input.
export const acorn = createRequire(
  new URL('../../packages/runtime-js/package.json', import.meta.url),
)('acorn');
if (acorn.version !== '8.16.0')
  throw new Error(`acorn drift (${acorn.version}): re-probe ADR-0575`);
/** Every AST node under `node` (acorn-walk `full`/`fullAncestor`): `cb(node, ancestors)`, ancestors ending in node. */
function visitAll(node, cb, ancestors = []) {
  if (node === null || typeof node !== 'object' || typeof node.type !== 'string') return;
  ancestors.push(node);
  cb(node, ancestors);
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) visitAll(c, cb, ancestors);
    else if (v !== null && typeof v === 'object') visitAll(v, cb, ancestors);
  }
  ancestors.pop();
}
const walk = {
  full: (node, cb) => visitAll(node, (n) => cb(n)),
  fullAncestor: (node, cb) => visitAll(node, (n, anc) => cb(n, undefined, anc)),
};

export const VENDOR = fileURLToPath(new URL('./node-streams/vendor/', import.meta.url));
const OUT = fileURLToPath(
  new URL('../../packages/io/src/streams/node/generated/', import.meta.url),
);
export const PINS = {
  'lib/stream.js': '3dec4d8da73ac37b6fcfd812ed252c12bf8355ccdc71ac6d669e76288f2a1857',
  'lib/stream/promises.js': '29606bc43e45922f0b39f633cad11d607afa2afcb35f3f1dcfe296219243031e',
  'lib/internal/assert.js': '03940c9b646255b631d3a95cf2a9ad156d587db8b0ac223d1a87f3fd5531a807',
  'lib/internal/errors.js': '3aec99056e74bbe3d64e89b05bda6ca49e56c9a5b5b2a5a75f2a5b67f42c1ca1',
  'lib/internal/events/abort_listener.js':
    '349abf5f54373518279092b802faa3ce9687d1e63cf81255290406c4a1c0302e',
  'lib/internal/fs/streams.js': 'f43ccd6f33688e4fe585428dba8d9b47e8f5e95358dbffe850c998e09ed4b78e',
  'lib/internal/fs/utils.js': 'e466935c22fbe5e9371f8e961215abf6fd99651d99e03272ad7c1c4d4bdb1b90',
  'lib/internal/streams/add-abort-signal.js':
    'd794b3292b60220df681ee1523ac2207f9caf467bb64fa602251c0865f686706',
  'lib/internal/streams/compose.js':
    '7e07e372c57d96edbf562e1e37e0d9fbee68c80f6612d02a84683c0da0986d8e',
  'lib/internal/streams/destroy.js':
    '74aaae64ff7e4553fbf981baffb1f1dab7748c1e3fedfbef59eb8ab9ed4ec22d',
  'lib/internal/streams/duplex.js':
    'e2b5d781357dff0e742517a3fb451750477a394d2306186ca119b671f71261d5',
  'lib/internal/streams/duplexify.js':
    '507d9fbf1d2a644f7b9f69a12d6c91fe94fecdc5199ad640f94e77e70c564e7c',
  'lib/internal/streams/duplexpair.js':
    '693d2e9525a62d7847cf4e4a35990eea34fe5f065e6357ecb3b1c8504a42f4bc',
  'lib/internal/streams/end-of-stream.js':
    'f6a0d6902051d5db33aa9ce76ca9be063ffbf4dcdd05cc27299e9e8709632a44',
  'lib/internal/streams/from.js':
    '4999ebb66e39a5aac7c246c6a521a7832159dc6436c1d5a1f0756a700d82e286',
  'lib/internal/streams/legacy.js':
    'ad4f9ef0255ff525b0248176a021bcdb3ec1fd3b4f302d2a3552af864ee6bcaa',
  'lib/internal/streams/operators.js':
    '656f0f0c3128c77bdc43d0f237eb4531e8d2f085fb2554363aeba854789ac1d9',
  'lib/internal/streams/passthrough.js':
    '52bed2d31129172fce7fb4d5dd1c0c45f59cc9185964cd6069c63ed4219163ec',
  'lib/internal/streams/pipeline.js':
    '96fcda8c76b24bdd763df8dec9cf5eb02acb2100ca2cf86994e4165022febfb9',
  'lib/internal/streams/readable.js':
    '09ecdbfab5aea9c861b97214745c2514d2f79cdab823c8fcf8aa3c3d9a9f51ae',
  'lib/internal/streams/state.js':
    '4b5e014feed92eab8832debc31090ec8a6024226fa147db37a448f89ad157c29',
  'lib/internal/streams/transform.js':
    'af0424491c8b4de48df33f57955d2d501bbaed8d80393a45a0fae84c62459af9',
  'lib/internal/streams/utils.js':
    '76f2a40f2e1b799a575116036549bf5eca5f69b9038a77b1016eee823e51625f',
  'lib/internal/streams/writable.js':
    '7aae77c483373029827412567e695c31c654ad8d405370d64a7480a46998bcc5',
  'lib/internal/url.js': '35896c160c4b0b8b8b47c4382c13d475350d26554e2f403c224e2b0e99e984a7',
  'lib/internal/util.js': 'a6a3fed1d2de1050cb8b119a2d792246e37abdea4099d90d6994d894f506c429',
  'lib/internal/validators.js': 'b01b3b0ce9919f157ec0b193bb2cf72ccb1a708cc8c3786acff8afb1287a4f46',
  'lib/internal/webstreams/adapters.js':
    'db707d0a6b0ee5600ab27a52ee6cee3a84cf28571e0030365ab7f839703d25a7',
  LICENSE: '4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18',
};
const ROOTS = ['stream', 'stream/promises', 'internal/fs/streams'];
const WHOLE = new Set([
  'internal/fs/streams',
  'internal/assert',
  'internal/events/abort_listener',
  'internal/webstreams/adapters',
]);
const isWhole = (id) =>
  id === 'stream' ||
  id === 'stream/promises' ||
  id.startsWith('internal/streams/') ||
  WHOLE.has(id);
/** Selected modules → names their selection reads from a binding instead of an upstream statement. */
export const PRELUDE = {
  'internal/errors': '',
  'internal/validators': '',
  'internal/util': '',
  // Narrowed upstream requires (fs/utils.js:28,45): the selection reads only these two names.
  'internal/fs/utils':
    "const { Buffer } = require('buffer');\nconst { isUint8Array } = require('internal/util/types');\n",
  // `toPathIfFileURL` (url.js:1694) calls `fileURLToPath`: rifty's `url` binding, not url.js:1622.
  'internal/url': "const { fileURLToPath } = require('url');\n",
};
/**
 * Upstream inputs outside the generated set (the bindings' contract): bound id → members read,
 * internalBinding ids, globals read. Anything else is drift.
 */
const EXPECTED = {
  bindings: {
    async_hooks: ['AsyncResource'],
    buffer: ['Buffer'],
    events: ['call', 'captureRejectionSymbol', 'prototype'],
    // `this[kFs]` (an `fs` option or this module): the whole module.
    fs: [],
    'internal/abort_controller': ['AbortController', 'AbortSignal'],
    'internal/blob': ['isBlob'],
    'internal/buffer': ['FastBuffer'],
    'internal/encoding': ['TextEncoder'],
    'internal/event_target': ['kResistStopPropagation', 'kWeakHandler'],
    'internal/fs/promises': ['FileHandle', 'kRef', 'kUnref'],
    'internal/process/task_queues': ['queueMicrotask'],
    'internal/process/warning': ['emitWarningSync'],
    'internal/util/debuglog': ['debuglog'],
    // `lazyInternalUtilInspect().inspect`/`.format` (errors.js): read through a function.
    'internal/util/inspect': [],
    'internal/util/types': ['isAnyArrayBuffer', 'isArrayBufferView', 'isUint8Array'],
    'internal/v8/startup_snapshot': ['namespace'],
    'internal/webstreams/queuingstrategies': ['ByteLengthQueuingStrategy', 'CountQueuingStrategy'],
    'internal/webstreams/readablestream': ['ReadableStream', 'isReadableStream'],
    'internal/webstreams/writablestream': ['WritableStream', 'isWritableStream'],
    string_decoder: ['StringDecoder'],
    url: ['fileURLToPath'],
    util: ['getSystemErrorName'],
  },
  internalBindings: ['constants', 'stream_wrap', 'types', 'uv'],
  hostGlobals: ['Infinity', 'NaN', 'arguments', 'undefined'],
};
const WRAPPER = new Set([
  'exports',
  'require',
  'module',
  'process',
  'internalBinding',
  'primordials',
]);

const parse = (text) =>
  acorn.parse(text, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowReturnOutsideFunction: true,
  });

/** Identifiers a node reads that it does not declare itself (over-approximate on declarations). */
function freeNames(node) {
  const declared = new Set();
  const used = new Set();
  const addPattern = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') declared.add(p.name);
    else if (p.type === 'ObjectPattern')
      for (const q of p.properties) addPattern(q.type === 'RestElement' ? q.argument : q.value);
    else if (p.type === 'ArrayPattern') for (const q of p.elements) addPattern(q);
    else if (p.type === 'RestElement') addPattern(p.argument);
    else if (p.type === 'AssignmentPattern') addPattern(p.left);
  };
  walk.fullAncestor(node, (n, _s, anc) => {
    const parent = anc[anc.length - 2];
    if (n.type === 'VariableDeclarator') addPattern(n.id);
    if (/Function/.test(n.type)) {
      if (n.id) declared.add(n.id.name);
      for (const p of n.params) addPattern(p);
    }
    if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id)
      declared.add(n.id.name);
    if (n.type === 'CatchClause') addPattern(n.param);
    if (n.type !== 'Identifier' || !parent) return;
    if (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
    if (
      (parent.type === 'Property' || /Method|PropertyDefinition/.test(parent.type)) &&
      parent.key === n &&
      !parent.computed &&
      !parent.shorthand
    )
      return;
    if (/Labeled|Break|Continue|MetaProperty/.test(parent.type)) return;
    used.add(n.name);
  });
  return [...used].filter((u) => !declared.has(u));
}

/** Top-level statements of a file by declared name; E('CODE', …) registrations by code. */
function index(text) {
  const byName = new Map();
  const errorDefs = new Map();
  const others = [];
  for (const st of parse(text).body) {
    const names = [];
    if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') names.push(st.id.name);
    if (st.type === 'VariableDeclaration')
      for (const d of st.declarations)
        walk.full(d.id, (n) => n.type === 'Identifier' && names.push(n.name));
    if (
      st.type === 'ExpressionStatement' &&
      st.expression.type === 'CallExpression' &&
      st.expression.callee.name === 'E'
    )
      errorDefs.set(st.expression.arguments[0].value, { st });
    else if (names.length) for (const n of names) byName.set(n, { st, names });
    else others.push({ st });
  }
  return { byName, errorDefs, others };
}

/**
 * Requires of a module text: id → member names read (destructured, `require(id).x`, or `x.y`
 * through the binding a `const x = require(id)` / `x ??= require(id)` declares).
 */
function requiresOf(text) {
  const out = new Map();
  const add = (id, n) => {
    if (!out.has(id)) out.set(id, new Set());
    if (n) out.get(id).add(n);
  };
  const names = (pat, id) => {
    if (pat.type === 'ObjectPattern')
      for (const p of pat.properties) add(id, p.key.name ?? p.key.value);
    else if (pat.type === 'Identifier')
      for (const m of text.matchAll(new RegExp(`(?<![\\w.$])${pat.name}\\.(\\w+)`, 'g')))
        add(id, m[1]);
  };
  walk.fullAncestor(parse(text), (n, _s, anc) => {
    if (n.type !== 'CallExpression' || n.callee.name !== 'require') return;
    const id = n.arguments[0].value;
    add(id);
    let parent = anc[anc.length - 2];
    if (parent.type === 'LogicalExpression' || parent.type === 'AssignmentExpression')
      parent = parent.type === 'AssignmentExpression' ? parent : anc[anc.length - 3];
    if (parent.type === 'MemberExpression' && parent.object === n) add(id, parent.property.name);
    else if (parent.type === 'VariableDeclarator') names(parent.id, id);
    else if (parent.type === 'AssignmentExpression') names(parent.left, id);
  });
  return out;
}
/** `codes: { ERR_X }` / `codes.ERR_X` reads of internal/errors. */
const codesOf = (text) => new Set(text.match(/\bERR_[A-Z0-9_]+\b/g) ?? []);
function declaredOf(text) {
  const s = new Set();
  for (const st of parse(text).body)
    for (const d of st.declarations ?? [])
      walk.full(d.id, (n) => n.type === 'Identifier' && s.add(n.name));
  return s;
}

export async function buildNodeStreams(vendor = VENDOR, pins = PINS) {
  const { vendored, sources, digest } = vendorReader(vendor, pins, 'ADR-0575');
  const read = (id) => vendored(`lib/${id}.js`);

  // 1. Whole modules: the require closure from the roots.
  const whole = new Map();
  const wants = new Map(); // selected id → names other modules read
  const bindIds = new Map(); // bound id → members read
  const bindAdd = (id, members) => {
    if (!bindIds.has(id)) bindIds.set(id, new Set());
    for (const m of members) bindIds.get(id).add(m);
  };
  const needCodes = new Set(['ERR_INTERNAL_ASSERTION']);
  const visit = async (text) => {
    for (const c of codesOf(text)) needCodes.add(c);
    for (const [dep, members] of requiresOf(text)) {
      if (isWhole(dep)) {
        if (!whole.has(dep)) {
          const t = await read(dep);
          whole.set(dep, t);
          await visit(t);
        }
      } else if (dep in PRELUDE) {
        if (!wants.has(dep)) wants.set(dep, new Set());
        for (const m of members) wants.get(dep).add(m);
      } else bindAdd(dep, members);
    }
  };
  for (const id of ROOTS) {
    const t = await read(id);
    whole.set(id, t);
    await visit(t);
  }

  // 2. Selected modules, to a fixpoint (a selection can read another selected module).
  const selected = new Map();
  const texts = new Map();
  for (const id of Object.keys(PRELUDE)) texts.set(id, await read(id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, prelude] of Object.entries(PRELUDE)) {
      const want = wants.get(id);
      if (!want) continue;
      const text = texts.get(id);
      const { byName, errorDefs, others } = index(text);
      const header = byName.get(
        [...byName.keys()].find(
          (k) => byName.get(k).st.declarations?.[0]?.init?.name === 'primordials',
        ),
      );
      const primNames = new Set(header ? header.names : []);
      const preludeNames = declaredOf(prelude);
      const exportNames = [...want].map((n) => n.split('.')[0]);
      const take = new Set();
      const codes = new Set();
      const queue = [...exportNames];
      if (id === 'internal/errors') for (const c of needCodes) codes.add(c);
      const pull = (st) => {
        for (const f of freeNames(st)) queue.push(f);
        for (const c of codesOf(text.slice(st.start, st.end))) codes.add(c);
      };
      for (const c of codes) if (errorDefs.has(c)) pull(errorDefs.get(c).st);
      while (queue.length) {
        const n = queue.pop();
        if (take.has(n) || primNames.has(n) || preludeNames.has(n) || !byName.has(n)) continue;
        const entry = byName.get(n);
        if (entry === header) continue;
        for (const m of entry.names) take.add(m);
        pull(entry.st);
        // Statements that finish a taken binding: `x.y = …` / ObjectDefineProperty(x, …).
        for (const o of others) {
          const e = o.st.expression;
          const target =
            e?.type === 'AssignmentExpression' && e.left.type === 'MemberExpression'
              ? e.left.object.name
              : e?.type === 'CallExpression' && /^ObjectDefineProperties?$/.test(e.callee.name)
                ? e.arguments[0]?.name
                : undefined;
          if (target && entry.names.includes(target) && !o.taken) {
            o.taken = true;
            pull(o.st);
          }
        }
        if (id === 'internal/errors')
          for (const c of codes)
            if (errorDefs.has(c) && !errorDefs.get(c).taken) {
              errorDefs.get(c).taken = true;
              pull(errorDefs.get(c).st);
            }
      }
      // Upstream order: each kept statement unedited, where it stands.
      const parts = [];
      const usedPrims = new Set();
      for (const st of parse(text).body) {
        const isE = st.type === 'ExpressionStatement' && st.expression.callee?.name === 'E';
        const keep = isE
          ? codes.has(st.expression.arguments[0].value)
          : others.some((o) => o.taken && o.st.start === st.start) ||
            [...take].some((n) => byName.get(n).st.start === st.start);
        if (!keep || (header && st.start === header.st.start)) continue;
        parts.push(text.slice(st.start, st.end));
        for (const f of freeNames(st)) if (primNames.has(f)) usedPrims.add(f);
      }
      const missing = exportNames.filter((n) => !take.has(n));
      if (missing.length)
        throw new Error(`node-streams: ${id} has no top-level ${missing.join(', ')}`);
      const prims = [...usedPrims].sort();
      const head = prims.length ? `const {\n  ${prims.join(',\n  ')},\n} = primordials;\n` : '';
      const body = `'use strict';\n${head}${prelude}${parts.join('\n')}\nmodule.exports = { ${[...new Set(exportNames)].sort().join(', ')} };\n`;
      if (selected.get(id) !== body) {
        selected.set(id, body);
        changed = true;
        for (const [dep, members] of requiresOf(body)) {
          if (dep in PRELUDE) {
            if (!wants.has(dep)) wants.set(dep, new Set());
            for (const m of members) wants.get(dep).add(m);
          } else if (!isWhole(dep)) bindAdd(dep, members);
        }
        for (const c of codesOf(body)) needCodes.add(c);
      }
    }
  }

  // 3. Every name a module reads: declared in it, a primordial, a wrapper parameter or a host global.
  const primordialNames = new Set();
  const hostGlobals = new Set();
  const internalBindings = new Set();
  for (const [, text] of [...whole, ...selected]) {
    const ast = parse(text);
    const top = new Set();
    for (const st of ast.body) {
      if (st.id) top.add(st.id.name);
      for (const d of st.declarations ?? []) {
        walk.full(d.id, (n) => n.type === 'Identifier' && top.add(n.name));
        if (d.init?.name === 'primordials')
          for (const p of d.id.properties) primordialNames.add(p.key.name);
      }
    }
    for (const m of text.matchAll(/internalBinding\('([^']+)'\)/g)) internalBindings.add(m[1]);
    for (const f of freeNames(ast)) if (!top.has(f) && !WRAPPER.has(f)) hostGlobals.add(f);
  }
  const found = {
    bindings: Object.fromEntries([...bindIds].sort().map(([k, v]) => [k, [...v].sort()])),
    internalBindings: [...internalBindings].sort(),
    hostGlobals: [...hostGlobals].sort(),
  };
  for (const key of Object.keys(EXPECTED))
    if (JSON.stringify(found[key]) !== JSON.stringify(EXPECTED[key]))
      throw new Error(
        `node-streams anchor drift: ${key} ${JSON.stringify(found[key])}; re-probe ADR-0575`,
      );

  // 4. Node's builtin loader: cache before run (a cycle sees partial exports), plain call
  //    (`this` undefined, as BuiltinModule.compileForInternalLoader), no intrinsic read at call time.
  const modules = [
    ...[...whole].map(([id, text]) => ({ id, kind: 'whole', text })),
    ...[...selected].map(([id, text]) => ({ id, kind: 'selected', text })),
  ].sort((a, b) => (a.id < b.id ? -1 : 1));
  const primordials = [...primordialNames].sort();
  const src = `export const PRIMORDIALS = ${JSON.stringify(primordials)};
export const BINDINGS = ${JSON.stringify(Object.keys(found.bindings))};
export const INTERNAL_BINDINGS = ${JSON.stringify(found.internalBindings)};
// Declarations only: a bundle that never creates the core drops all of it (trap io-treeshake-side-effect).
export default function createNodeStreamCore(primordials, internalBinding, bind, process) {
  for (let i = 0; i < PRIMORDIALS.length; i++)
    if (primordials[PRIMORDIALS[i]] === undefined) throw new TypeError('node-streams: no primordial ' + PRIMORDIALS[i]);
  const defs = {
    __proto__: null,
${modules.map(({ id, text }) => `${JSON.stringify(id)}: function (exports, require, module, process, internalBinding, primordials) {\n${text}\n}`).join(',\n')}
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
  return load;
}
`;
  const license = await vendored('LICENSE');
  return {
    modules,
    src,
    sha: digest(),
    sources,
    report: { ...found, primordials },
    license: `${nodeLicensePart(license).trimEnd()}\n`,
  };
}

/** Build, minify, then `--write` or `--check` the generated files in `out`. */
export async function generate(mode, { vendor = VENDOR, out = OUT, pins = PINS } = {}) {
  const built = await buildNodeStreams(vendor, pins);
  const compiled = await transform(built.src, {
    format: 'esm',
    target: 'es2022',
    minifyWhitespace: true,
    minifySyntax: true,
    legalComments: 'none',
  });
  const files = {
    'node-streams.js': `// Generated by tools/publishing/generate-node-streams.mjs; do not edit. ADR-0575.\n// Node ${NODE} lib/stream.js, lib/stream/promises.js, lib/internal/streams/*.js (17), lib/internal/fs/streams.js, lib/internal/{assert,events/abort_listener,webstreams/adapters}.js whole; lib/internal/{errors,validators,util,fs/utils,url}.js statements read; sources sha256 ${built.sha}; esbuild ${esbuildVersion}. MIT, node.LICENSE.\n${compiled.code}`,
    'node.LICENSE': built.license,
    'sources.json': `${JSON.stringify(
      {
        node: NODE,
        esbuild: esbuildVersion,
        sha256: built.sha,
        sources: built.sources,
        modules: Object.fromEntries(built.modules.map((m) => [m.id, m.kind])),
        ...built.report,
      },
      null,
      2,
    )}\n`,
  };
  await emit(mode, out, files, 'node-streams', 'pnpm node-streams:generate');
  return { built, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = cliMode(process.argv, 'generate-node-streams.mjs', 'ADR-0575');
  const { built, files } = await generate(mode);
  console.log(
    `node-streams ${mode}: Node ${NODE}, ${built.modules.length} modules, ${Buffer.byteLength(files['node-streams.js'])} bytes, ${built.sha}`,
  );
}
