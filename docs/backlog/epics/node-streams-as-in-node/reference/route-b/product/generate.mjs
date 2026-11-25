// Route B product shape, build-time generator (url-legacy precedent, ADR-0574): Node v24.16.0's stream core,
// lib/internal/fs/streams.js, internal/assert, internal/events/abort_listener and internal/webstreams/adapters
// unedited, each as a lazy CJS module function; internal/{errors,validators,util,fs/utils,url} as upstream
// statements selected by name (the closure of what the other modules read, header narrowed to the primordials
// the selection uses). Every other id is a rifty binding (bindings.ts). Records each source's sha256.
// usage: node generate.mjs REPO NODE_SRC OUT_DIR [--minify|--minify-all]   (writes OUT_DIR/node-streams.js, sources.json)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [repo, nodeSrc, outDir, flag] = process.argv.slice(2);
const hoisted = createRequire(join(repo, 'node_modules/.pnpm/node_modules/acorn/package.json'));
const acorn = hoisted('acorn');
const walk = hoisted('acorn-walk');
const esbuild = createRequire(join(repo, 'package.json'))('esbuild');

// ABORT=derived (variant B of the abort-listener unit): Node's abort_listener is left out and the
// binding's dependent-signal version is used. Default (variant A): Node's file, as in the source.
const WHOLE = new Set([
  'internal/fs/streams',
  'internal/assert',
  'internal/webstreams/adapters',
  ...(process.env.ABORT === 'derived' ? [] : ['internal/events/abort_listener']),
]);
const isWhole = (id) =>
  id === 'stream' ||
  id === 'stream/promises' ||
  id.startsWith('internal/streams/') ||
  WHOLE.has(id);
/** Selected modules: file, and the statements rifty provides in their place (rifty bindings). */
const SLICED = {
  'internal/errors': { prelude: '' },
  'internal/validators': { prelude: '' },
  'internal/util': { prelude: '' },
  'internal/fs/utils': {
    prelude:
      "const { Buffer } = require('buffer');\nconst { isUint8Array } = require('internal/util/types');\n",
  },
  'internal/url': { prelude: "const { fileURLToPath } = require('url');\n" },
};
const ROOTS = ['stream', 'stream/promises', 'internal/fs/streams'];

const sources = {};
const read = (id) => {
  const path = `lib/${id}.js`;
  const text = readFileSync(join(nodeSrc, path), 'utf8');
  sources[path] = createHash('sha256').update(text).digest('hex');
  return text;
};
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
    if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression')
      n.id && declared.add(n.id.name);
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
    if (/Labeled|Break|Continue/.test(parent.type)) return;
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
    const src = text.slice(st.start, st.end);
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
      errorDefs.set(st.expression.arguments[0].value, { st, src });
    else if (names.length) for (const n of names) byName.set(n, { st, src, names });
    else others.push({ st, src });
  }
  return { byName, errorDefs, others };
}

/** Requires of a module text: id → member names read (destructured or `.x`). */
function requiresOf(text) {
  const out = new Map();
  const add = (id, n) => {
    if (!out.has(id)) out.set(id, new Set());
    if (n) out.get(id).add(n);
  };
  const names = (pat, id) => {
    if (pat.type !== 'ObjectPattern') return;
    for (const p of pat.properties) add(id, p.key.name ?? p.key.value);
  };
  walk.fullAncestor(parse(text), (n, _s, anc) => {
    if (n.type !== 'CallExpression' || n.callee.name !== 'require') return;
    const id = n.arguments[0].value.replace(/^node:/, '');
    add(id);
    const parent = anc[anc.length - 2];
    if (parent.type === 'MemberExpression' && parent.object === n) add(id, parent.property.name);
    else if (parent.type === 'VariableDeclarator') names(parent.id, id);
    else if (parent.type === 'AssignmentExpression' && parent.left.type === 'ObjectPattern')
      names(parent.left, id);
  });
  return out;
}
/** `codes: { ERR_X }` / `codes.ERR_X` reads of internal/errors. */
const codesOf = (text) => new Set(text.match(/\bERR_[A-Z0-9_]+\b/g) ?? []);

// 1. Whole modules: the require closure from the roots.
const whole = new Map();
const wants = new Map(); // sliced id → names other modules read
const bindIds = new Map(); // rifty-bound id → names read
const bindAdd = (id, members) => {
  if (!bindIds.has(id)) bindIds.set(id, new Set());
  for (const m of members) bindIds.get(id).add(m);
};
const needCodes = new Set(['ERR_INTERNAL_ASSERTION']);
const visit = (text) => {
  for (const c of codesOf(text)) needCodes.add(c);
  for (const [dep, members] of requiresOf(text)) {
    if (isWhole(dep)) {
      if (!whole.has(dep)) {
        const t = read(dep);
        whole.set(dep, t);
        visit(t);
      }
    } else if (dep in SLICED) {
      if (!wants.has(dep)) wants.set(dep, new Set());
      for (const m of members) wants.get(dep).add(m);
    } else bindAdd(dep, members);
  }
};
for (const id of ROOTS) {
  const t = read(id);
  whole.set(id, t);
  visit(t);
}

// 2. Sliced modules, to a fixpoint (a selection can read another sliced module).
const sliced = new Map();
for (let changed = true; changed; ) {
  changed = false;
  for (const [id, spec] of Object.entries(SLICED)) {
    const want = wants.get(id);
    if (!want) continue;
    const text = read(id);
    const { byName, errorDefs, others } = index(text);
    const header = byName.get(
      [...byName.keys()].find(
        (k) => byName.get(k).st.declarations?.[0]?.init?.name === 'primordials',
      ),
    );
    const primNames = new Set(header ? header.names : []);
    const preludeNames = declaredOf(spec.prelude);
    const exportNames = [...want].map((n) => n.split('.')[0]);
    const take = new Set();
    const codes = new Set();
    const queue = [...exportNames];
    if (id === 'internal/errors') for (const c of needCodes) codes.add(c);
    const pull = (st) => {
      for (const f of freeNames(st)) queue.push(f);
      for (const c of codesOf(text.slice(st.start, st.end))) codes.add(c);
    };
    for (const c of codes) errorDefs.has(c) && pull(errorDefs.get(c).st);
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
    // Upstream order: declarations, then the finishing statements and E() calls where they stand.
    const parts = [];
    const usedPrims = new Set();
    for (const st of parse(text).body) {
      const src = text.slice(st.start, st.end);
      const isE = st.type === 'ExpressionStatement' && st.expression.callee?.name === 'E';
      const keep = isE
        ? codes.has(st.expression.arguments[0].value)
        : others.some((o) => o.taken && o.st.start === st.start) ||
          [...take].some((n) => byName.get(n).st.start === st.start);
      if (!keep || (header && st.start === header.st.start)) continue;
      parts.push(src);
      for (const f of freeNames(st)) if (primNames.has(f)) usedPrims.add(f);
    }
    const missing = exportNames.filter((n) => !take.has(n));
    if (missing.length) throw new Error(`${id}: no top-level ${missing.join(', ')}`);
    const body = `'use strict';\nconst {\n  ${[...usedPrims].sort().join(',\n  ')},\n} = primordials;\n${spec.prelude}${parts.join('\n')}\nmodule.exports = { ${[...new Set(exportNames)].sort().join(', ')} };\n`;
    if (sliced.get(id) !== body) {
      sliced.set(id, body);
      changed = true;
      for (const [dep, members] of requiresOf(body)) {
        if (dep in SLICED) {
          if (!wants.has(dep)) wants.set(dep, new Set());
          for (const m of members) wants.get(dep).add(m);
        } else if (!isWhole(dep)) bindAdd(dep, members);
      }
      for (const c of codesOf(body)) needCodes.add(c);
    }
  }
}
function declaredOf(text) {
  const s = new Set();
  for (const st of parse(text).body)
    for (const d of st.declarations ?? [])
      walk.full(d.id, (n) => n.type === 'Identifier' && s.add(n.name));
  return s;
}

// 3. Checks: every name a module reads is declared in it, a primordial, a CJS wrapper parameter or a host global.
const WRAPPER = new Set([
  'exports',
  'require',
  'module',
  'process',
  'internalBinding',
  'primordials',
]);
const primordialNames = new Set();
const hostGlobals = new Set();
const internalBindings = new Set();
for (const [id, text] of [...whole, ...sliced]) {
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
  for (const f of freeNames(ast))
    if (!top.has(f) && !WRAPPER.has(f)) hostGlobals.add(`${f} (${id})`);
}

// 4. Emit: lazy module functions, Node's require semantics (cache before run, cycles see partial exports).
const mods = [...whole, ...sliced].sort(([a], [b]) => a.localeCompare(b));
const body = mods
  .map(
    ([id, text]) =>
      `${JSON.stringify(id)}: function (exports, require, module, process, internalBinding, primordials) {\n${text}\n}`,
  )
  .join(',\n');
const PRIMS = [...primordialNames].sort();
const src = `export const PRIMORDIALS = ${JSON.stringify(PRIMS)};
export const BINDINGS = ${JSON.stringify([...bindIds.keys()].sort())};
export const INTERNAL_BINDINGS = ${JSON.stringify([...internalBindings].sort())};
// A pure call: a bundle that never creates the streams drops all of it (trap io-treeshake-side-effect;
// anonymous, so esbuild keepNames adds no top-level __name call).
export default /* @__PURE__ */ (() => function (primordials, internalBinding, bind, process) {
  for (const n of PRIMORDIALS) if (!(n in primordials)) throw new Error('route B: no primordial ' + n);
  const defs = {
${body}
  };
  const cache = Object.create(null);
  function load(id) {
    const bare = id.startsWith('node:') ? id.slice(5) : id;
    if (bare in cache) return cache[bare].exports;
    if (!Object.hasOwn(defs, bare)) return bind(bare);
    const module = { exports: {} };
    cache[bare] = module;
    defs[bare].call(module.exports, module.exports, load, module, process, internalBinding, primordials);
    return module.exports;
  }
  return load;
})();
`;
// --minify: whitespace and syntax only. Identifiers stay: V8's own TypeError messages quote them
// ("signal.addEventListener is not a function"); --minify-all also renames (size comparison only).
const out = flag?.startsWith('--minify')
  ? (
      await esbuild.transform(src, {
        format: 'esm',
        target: 'es2022',
        minifyWhitespace: true,
        minifySyntax: true,
        minifyIdentifiers: flag === '--minify-all',
        keepNames: true,
        legalComments: 'none',
      })
    ).code
  : src;
const sha = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'node-streams.js'),
  `// Generated by route-b/product/generate.mjs; do not edit. Node v24.16.0, sources sha256 ${sha}; esbuild ${esbuild.version}. MIT.\n${out}`,
);
const report = {
  node: 'v24.16.0',
  sha256: sha,
  sources,
  modules: mods.map(([id, t]) => `${id}${sliced.has(id) ? ' (selected)' : ''} ${t.length}`),
  bindings: Object.fromEntries([...bindIds].sort().map(([k, v]) => [k, [...v].sort()])),
  internalBindings: [...internalBindings].sort(),
  primordials: PRIMS,
  hostGlobals: [...hostGlobals].sort(),
};
writeFileSync(join(outDir, 'sources.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `node-streams.js ${Buffer.byteLength(out)} B, ${mods.length} modules; bindings: ${Object.keys(report.bindings).join(' ')}; internalBinding: ${report.internalBindings.join(' ')}; primordials ${PRIMS.length}`,
);
console.log(`host globals: ${report.hostGlobals.join(', ')}`);
