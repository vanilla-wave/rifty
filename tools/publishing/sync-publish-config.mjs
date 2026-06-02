#!/usr/bin/env node
/**
 * Sync the npm-publish configuration across every publishable @rifty package
 * (ADR-0070). Single source of truth: edit the SPEC below (or add a package),
 * then run `pnpm sync:publish`. Idempotent — safe to re-run.
 *
 * What it writes per package:
 *   - package.json: drops `private`, sets version/license/repo/keywords,
 *     `sideEffects`, `files`, a `build` script, and a `publishConfig` block that
 *     overrides main/module/types/exports to point at the built `dist/` (pnpm
 *     applies publishConfig only to the PUBLISHED manifest, so the in-repo
 *     `exports` keep pointing at raw `./src/*.ts` for the fast dev/HMR loop).
 *   - tsup.config.ts: one ESM + bundled-.d.ts entry per public export.
 *
 * The dev `exports`/`main`/`module`/`types` are intentionally left on `./src`.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ─── Release knobs ──────────────────────────────────────────────────────────
const VERSION = '0.1.0';
// VERIFY this matches the real GitHub repo (owner/name). Used for the npm
// "Repository"/"Homepage" links and for npm provenance on release.
const REPO_URL = 'https://github.com/vanilla-wave/rifty';
const AUTHOR = 'vanilla-wave <vizetmail@gmail.com>';
const BASE_KEYWORDS = ['rifty', 'browser', 'webcontainer'];

// ─── Per-package publish spec ────────────────────────────────────────────────
// sideEffects: false (pure, tree-shakeable) OR an array of built files that run
// import-time registration/bootstrap and must never be tree-shaken away.
// addExports: subpath exports to add to the dev exports map before deriving.
// dropExports: dev-only subpaths to exclude from the published exports.
const SPEC = {
  '@rifty/io': {
    dir: 'packages/io',
    sideEffects: false,
    keywords: ['stream', 'buffer', 'eventemitter'],
  },
  '@rifty/vfs': {
    dir: 'packages/vfs',
    sideEffects: false,
    keywords: ['vfs', 'opfs', 'filesystem'],
  },
  '@rifty/kernel': {
    dir: 'packages/kernel',
    sideEffects: ['./dist/worker-entry.js'],
    keywords: ['kernel', 'worker', 'ipc', 'sharedarraybuffer'],
  },
  '@rifty/net': {
    dir: 'packages/net',
    sideEffects: ['./dist/register-builtins.js', './dist/sqlite/register-builtins.js'],
    keywords: ['http', 'net', 'websocket', 'sqlite'],
  },
  '@rifty/runtime-js': {
    dir: 'packages/runtime-js',
    sideEffects: ['./dist/index.js', './dist/worker.js'],
    removeDeps: ['acorn-walk'], // declared but never imported (ADR-0070 D6)
    keywords: ['runtime', 'node-compatible', 'module-loader'],
  },
  '@rifty/runtime-wasi': {
    dir: 'packages/runtime-wasi',
    sideEffects: ['./dist/worker-entry.js'],
    addExports: { './worker-entry': './src/worker-entry.ts' },
    keywords: ['wasi', 'wasm'],
  },
  '@rifty/npm-client': {
    dir: 'packages/npm-client',
    sideEffects: false,
    keywords: ['npm', 'semver', 'install'],
  },
  '@rifty/shell': { dir: 'packages/shell', sideEffects: false, keywords: ['shell', 'bash'] },
  '@rifty/terminal': {
    dir: 'packages/terminal',
    sideEffects: false,
    keywords: ['terminal', 'xterm'],
  },
  '@rifty/service-worker': {
    dir: 'packages/service-worker',
    sideEffects: ['./dist/sw.js'],
    keywords: ['service-worker', 'preview'],
  },
  '@rifty/shadow-registry': {
    dir: 'tools/shadow-registry',
    sideEffects: false,
    // ./esbuild-binding uses node:fs + a vendored ~20MB WASM (playground/build
    // tooling only); keep it for the workspace, never ship it to npm.
    dropExports: ['./esbuild-binding'],
    keywords: ['npm-overrides'],
  },
};

const DESCRIPTIONS = {
  '@rifty/io':
    'Isomorphic primitives for rifty: EventEmitter, Buffer, and a node-compatible stream stack.',
  '@rifty/vfs':
    'Virtual filesystem for rifty: in-memory + OPFS backends with a synchronous mirror.',
  '@rifty/kernel':
    'Process/scheduling/IPC kernel for rifty: Worker-as-process model over SharedArrayBuffer + Atomics.',
  '@rifty/net': 'Browser node:net/node:http/node:https/ws + node:sqlite (sql.js) for rifty.',
  '@rifty/runtime-js':
    'Node-compatible JS runtime for rifty: CJS/ESM module loader and node: builtins, in a Worker.',
  '@rifty/runtime-wasi': 'WASI (preview1) runner for rifty: run .wasm guests in a Web Worker.',
  '@rifty/npm-client':
    'In-browser npm client for rifty: semver, registry, tarball extract, link, install.',
  '@rifty/shell': 'Tiny bash-flavoured shell for rifty, backed by @rifty/vfs.',
  '@rifty/terminal': 'xterm.js terminal wrapper for rifty.',
  '@rifty/service-worker': 'Service Worker preview/HMR routing bridge for rifty.',
  '@rifty/shadow-registry': 'Data tables of in-browser npm package substitutions for rifty.',
};

const dedupe = (a) => [...new Set(a)];

function buildExportsAndEntries(orig, spec) {
  const devExports = { ...(orig.exports ?? { '.': './src/index.ts' }), ...(spec.addExports ?? {}) };
  const pubExports = {};
  const entries = {};
  for (const [key, val] of Object.entries(devExports)) {
    if (spec.dropExports?.includes(key)) continue;
    const distKey = key === '.' ? 'index' : key.replace(/^\.\//, '');
    entries[distKey] = val.replace(/^\.\//, '');
    pubExports[key] = { types: `./dist/${distKey}.d.ts`, import: `./dist/${distKey}.js` };
  }
  return { devExports, pubExports, entries };
}

function rebuildPkg(orig, name, spec) {
  const { devExports, pubExports } = buildExportsAndEntries(orig, spec);
  const files = ['dist'];
  if (existsSync(join(ROOT, spec.dir, 'CHANGELOG.md'))) files.push('CHANGELOG.md');

  const out = {
    name,
    version: VERSION,
    description: orig.description ?? DESCRIPTIONS[name] ?? `rifty ${name}`,
    type: 'module',
    license: 'MIT',
    author: AUTHOR,
    repository: { type: 'git', url: `git+${REPO_URL}.git`, directory: spec.dir },
    homepage: `${REPO_URL}#readme`,
    bugs: { url: `${REPO_URL}/issues` },
    keywords: dedupe([...BASE_KEYWORDS, ...(spec.keywords ?? [])]),
    sideEffects: spec.sideEffects,
    main: './src/index.ts',
    module: './src/index.ts',
    types: './src/index.ts',
    exports: devExports,
    files,
    publishConfig: {
      access: 'public',
      main: './dist/index.js',
      module: './dist/index.js',
      types: './dist/index.d.ts',
      exports: pubExports,
    },
    scripts: { ...orig.scripts, build: 'tsup' },
  };
  if (orig.dependencies) {
    out.dependencies = { ...orig.dependencies };
    for (const dep of spec.removeDeps ?? []) delete out.dependencies[dep];
  }
  if (orig.peerDependencies) out.peerDependencies = orig.peerDependencies;
  if (orig.devDependencies) out.devDependencies = orig.devDependencies;
  // Preserve stray keys we don't manage (e.g. `// TODO(ADR)` markers), but
  // never resurrect `private` — these packages are deliberately publishable.
  for (const [k, v] of Object.entries(orig)) {
    if (k === 'private') continue;
    if (!(k in out)) out[k] = v;
  }
  return out;
}

function tsupConfig(entries) {
  // Emit Biome's style: single quotes, object keys unquoted when valid idents.
  const isIdent = (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k);
  const body = Object.entries(entries)
    .map(([k, v]) => `    ${isIdent(k) ? k : `'${k}'`}: '${v}',`)
    .join('\n');
  return `import { defineConfig } from 'tsup';

// Generated by tools/publishing/sync-publish-config.mjs (ADR-0070). Do not edit by hand.
// Bundles each public entry to ESM + a bundled .d.ts in dist/. First-party
// @rifty/* and declared external deps stay external (not double-bundled).
export default defineConfig({
  entry: {
${body}
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: [/^@rifty\\//],
});
`;
}

let changed = 0;
for (const [name, spec] of Object.entries(SPEC)) {
  const pkgPath = join(ROOT, spec.dir, 'package.json');
  const orig = JSON.parse(await readFile(pkgPath, 'utf8'));
  const { entries } = buildExportsAndEntries(orig, spec);
  const next = rebuildPkg(orig, name, spec);
  await writeFile(pkgPath, `${JSON.stringify(next, null, 2)}\n`);
  await writeFile(join(ROOT, spec.dir, 'tsup.config.ts'), tsupConfig(entries));
  console.log(
    `synced ${name} (${Object.keys(entries).length} entr${Object.keys(entries).length === 1 ? 'y' : 'ies'})`,
  );
  changed++;
}
console.log(`\n${changed} package(s) synced. Run \`pnpm build:libs\` to produce dist/.`);
