#!/usr/bin/env node
/**
 * Sync the npm-publish configuration across every publishable @riftydev package
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
const args = process.argv.slice(2);
const checkOnly = args.length === 1 && args[0] === '--check';
if (args.length > 0 && !checkOnly) {
  throw new Error(`Unknown sync-publish-config arguments: ${args.join(', ')}`);
}

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
  // Umbrella front door (EPIC B / ADR-0071). `@riftydev/sdk`: re-exports every
  // @riftydev/* layer on a subpath plus the framework-free createSandbox()
  // façade. First-party deps stay external (DD-1), so subpath imports share the
  // same singleton state as direct @riftydev/* imports. (Was unscoped `rifty`
  // per DD-2, but npm blocked that name as too similar to existing packages.)
  '@riftydev/sdk': {
    dir: 'packages/rifty',
    sideEffects: false,
    keywords: ['runtime', 'sdk', 'sandbox', 'node-compatible', 'wasi'],
  },
  '@riftydev/io': {
    dir: 'packages/io',
    sideEffects: false,
    keywords: ['stream', 'buffer', 'eventemitter'],
  },
  '@riftydev/vfs': {
    dir: 'packages/vfs',
    sideEffects: false,
    keywords: ['vfs', 'opfs', 'filesystem'],
  },
  '@riftydev/kernel': {
    dir: 'packages/kernel',
    sideEffects: ['./dist/worker-entry.js'],
    keywords: ['kernel', 'worker', 'ipc', 'sharedarraybuffer'],
  },
  '@riftydev/net': {
    dir: 'packages/net',
    sideEffects: ['./dist/register-builtins.js', './dist/sqlite/register-builtins.js'],
    keywords: ['http', 'net', 'websocket', 'sqlite'],
  },
  '@riftydev/git': { dir: 'packages/git', sideEffects: false, keywords: ['git', 'vcs'] },
  '@riftydev/runtime-js': {
    dir: 'packages/runtime-js',
    sideEffects: ['./dist/index.js', './dist/worker.js'],
    removeDeps: ['acorn-walk'], // declared but never imported (ADR-0070 D6)
    // execSync handler seam (ipc/exec-sync-handler): a host realm that owns the
    // dispatcher (calls spawnWorker) registers the 'execSync' handler here so
    // kernel-spawned guests run execSync end-to-end (e.g. the COI-Worker e2e
    // harness). The playground page never require()s child_process, so the lazy
    // first-require install never fires on the dispatcher-owning realm.
    addExports: {
      './ipc/exec-sync-handler': './src/ipc/exec-sync-handler.ts',
      // The real node:child_process surface (execSync/spawn/exec/fork). Exposed
      // so a kernel-spawned guest entry (kind:'url', no module loader) can call
      // the genuine execSync client without re-implementing the SAB gate.
      './builtins/child_process': './src/builtins/child_process.ts',
      './builtins/process-identity': './src/builtins/process-identity.ts',
      // node:os / node:path faithful shims (ADR-0026) exposed so a Vite bundle
      // containing a heavy node-targeting dep (the `typescript` engine in the
      // ts-language-service worker, ADR-0166) can ALIAS the bare `os`/`path`
      // specifiers to the REAL rifty shims instead of Vite's empty browser stub
      // (`os.platform is not a function` at the dep's module-eval). Not a new
      // mechanism — the same modules already back the `require('os')` registry.
      './builtins/os': './src/builtins/os.ts',
      './builtins/path': './src/builtins/path.ts',
      './builtins/perf_hooks': './src/builtins/perf_hooks.ts',
      './builtins/fs': './src/builtins/fs.ts',
    },
    keywords: ['runtime', 'node-compatible', 'module-loader'],
  },
  '@riftydev/runtime-wasi': {
    dir: 'packages/runtime-wasi',
    sideEffects: ['./dist/worker-entry.js'],
    addExports: { './wasi': './src/wasi.ts', './worker-entry': './src/worker-entry.ts' },
    keywords: ['wasi', 'wasm'],
  },
  '@riftydev/npm-client': {
    dir: 'packages/npm-client',
    sideEffects: false,
    addExports: { './internal': './src/internal/index.ts' },
    keywords: ['npm', 'semver', 'install'],
  },
  '@riftydev/shell': { dir: 'packages/shell', sideEffects: false, keywords: ['shell', 'bash'] },
  '@riftydev/ts-language-service': {
    dir: 'packages/ts-language-service',
    // The kernel `serve`-worker boot self-installs on load (auto-boot guard) —
    // mark it side-effecting so tree-shaking can't drop it (mirrors kernel/
    // runtime-wasi worker-entry).
    sideEffects: ['./dist/worker/entry.js'],
    // `./protocol` + `./lsp-types` are LIGHT subpaths (pure types/constants, NO
    // `typescript` engine) the playground page + owner relay import — so they get
    // the `rifty:ts-lsp` frame guards + LSP shapes WITHOUT pulling the whole TS
    // language service (the index re-exports service.ts → typescript) into the
    // page/owner bundle (ADR-0166 P1.9).
    addExports: {
      './protocol': './src/worker/protocol.ts',
      './lsp-types': './src/lsp-types.ts',
      './worker/entry': './src/worker/entry.ts',
    },
    // ADR-0177 retains the vendored TS std-lib bundle as a package/test resource;
    // it is an asset, not a JS entry, so no tsup bundling / .d.ts.
    assetExports: { './vendor/lib-bundle.json': './vendor/lib-bundle.json' },
    extraFiles: ['vendor'],
    keywords: ['typescript', 'language-service', 'lsp', 'diagnostics'],
  },
  '@riftydev/terminal': {
    dir: 'packages/terminal',
    sideEffects: false,
    addExports: {
      './autocomplete': './src/autocomplete.ts',
      './command-blocks': './src/command-blocks.ts',
      './export': './src/export.ts',
      './history': './src/history.ts',
      './state': './src/state.ts',
    },
    keywords: ['terminal', 'xterm'],
  },
  '@riftydev/service-worker': {
    dir: 'packages/service-worker',
    sideEffects: ['./dist/sw.js'],
    keywords: ['service-worker', 'preview'],
  },
  '@riftydev/workbench': {
    dir: 'packages/workbench',
    sideEffects: [
      './dist/owner-worker.js',
      './dist/kernel-worker.js',
      './dist/node-worker.js',
      './dist/dev-server-worker.js',
      './dist/typescript-worker.js',
      './dist/no-coi-toolchain-worker.js',
    ],
    addExports: {
      './no-coi-toolchain-worker': './src/workers/no-coi-toolchain-worker.ts',
    },
    keywords: ['workbench', 'development-environment', 'browser-runtime'],
  },
  '@riftydev/shadow-registry': {
    dir: 'tools/shadow-registry',
    sideEffects: false,
    addExports: { './internal': './src/internal/index.ts' },
    keywords: ['npm-overrides'],
  },
};

const DESCRIPTIONS = {
  '@riftydev/sdk':
    'rifty SDK — a browser-based Node-compatible runtime + WASI runner. One install, all the parts, plus a framework-free createSandbox() façade.',
  '@riftydev/io':
    'Isomorphic primitives for rifty: EventEmitter, Buffer, and a node-compatible stream stack.',
  '@riftydev/vfs':
    'Virtual filesystem for rifty: in-memory + OPFS backends with a synchronous mirror.',
  '@riftydev/kernel':
    'Process/scheduling/IPC kernel for rifty: Worker-as-process model over SharedArrayBuffer + Atomics.',
  '@riftydev/net': 'Browser node:net/node:http/node:https/ws + node:sqlite (sql.js) for rifty.',
  '@riftydev/git': 'Git client for rifty: version control over @riftydev/vfs (isomorphic-git).',
  '@riftydev/runtime-js':
    'Node-compatible JS runtime for rifty: CJS/ESM module loader and node: builtins, in a Worker.',
  '@riftydev/runtime-wasi': 'WASI (preview1) runner for rifty: run .wasm guests in a Web Worker.',
  '@riftydev/npm-client':
    'In-browser npm client for rifty: semver, registry, tarball extract, link, install.',
  '@riftydev/shell': 'Tiny bash-flavoured shell for rifty, backed by @riftydev/vfs.',
  '@riftydev/ts-language-service':
    'TypeScript language service over the rifty VFS: LSP-shaped diagnostics, hostable in a kernel worker.',
  '@riftydev/terminal': 'xterm.js terminal wrapper for rifty.',
  '@riftydev/service-worker': 'Service Worker preview/HMR routing bridge for rifty.',
  '@riftydev/workbench':
    'Framework-free embeddable development workbench over the rifty browser runtime.',
  '@riftydev/shadow-registry': 'Data tables of in-browser npm package substitutions for rifty.',
};

const dedupe = (a) => [...new Set(a)];

function buildExportsAndEntries(orig, spec) {
  const devExports = {
    ...(orig.exports ?? {}),
    '.': './src/index.ts',
    ...(spec.addExports ?? {}),
  };
  const pubExports = {};
  const entries = {};
  for (const [key, val] of Object.entries(devExports)) {
    if (spec.dropExports?.includes(key)) continue;
    const distKey = key === '.' ? 'index' : key.replace(/^\.\//, '');
    entries[distKey] = val.replace(/^\.\//, '');
    pubExports[key] = { types: `./dist/${distKey}.d.ts`, import: `./dist/${distKey}.js` };
  }
  // assetExports: dev + published static-asset subpaths that are NOT JS entries
  // (no tsup bundling, no .d.ts) — e.g. a vendored JSON the consumer fetches by
  // URL. Same committed path in dev and the published tarball (the file is listed
  // in `files`). Added to both export maps AFTER the JS entries so it never
  // becomes a tsup entry.
  for (const [key, val] of Object.entries(spec.assetExports ?? {})) {
    devExports[key] = val;
    pubExports[key] = val;
  }
  return { devExports, pubExports, entries };
}

function rebuildPkg(orig, name, spec) {
  const { devExports, pubExports } = buildExportsAndEntries(orig, spec);
  const files = ['dist', ...(spec.extraFiles ?? [])];
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
  const entryBody = (selectedEntries, indent = '    ') =>
    Object.entries(selectedEntries)
      .map(([k, v]) => `${indent}${isIdent(k) ? k : `'${k}'`}: '${v}',`)
      .join('\n');
  return `import { defineConfig } from 'tsup';

// Generated by tools/publishing/sync-publish-config.mjs (ADR-0070). Do not edit by hand.
// Bundles each public entry to ESM + a bundled .d.ts in dist/. First-party
// @riftydev/* and declared external deps stay external (not double-bundled).
export default defineConfig({
  entry: {
${entryBody(entries)}
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: [/^@riftydev\\//],
});
`;
}

let changed = 0;
const drift = [];
for (const [name, spec] of Object.entries(SPEC)) {
  const pkgPath = join(ROOT, spec.dir, 'package.json');
  const packageSource = await readFile(pkgPath, 'utf8');
  const orig = JSON.parse(packageSource);
  const { entries } = buildExportsAndEntries(orig, spec);
  const next = rebuildPkg(orig, name, spec);
  const tsupPath = join(ROOT, spec.dir, 'tsup.config.ts');
  const nextTsup = tsupConfig(entries);
  if (checkOnly) {
    if (JSON.stringify(orig) !== JSON.stringify(next)) drift.push(pkgPath);
    if ((await readFile(tsupPath, 'utf8')) !== nextTsup) drift.push(tsupPath);
  } else {
    await writeFile(pkgPath, `${JSON.stringify(next, null, 2)}\n`);
    await writeFile(tsupPath, nextTsup);
  }
  console.log(
    `${checkOnly ? 'checked' : 'synced'} ${name} (${Object.keys(entries).length} entr${Object.keys(entries).length === 1 ? 'y' : 'ies'})`,
  );
  changed++;
}
if (drift.length > 0) {
  throw new Error(
    `Generated publish configuration drift:\n${drift.map((path) => `- ${path}`).join('\n')}`,
  );
}
console.log(
  checkOnly
    ? `\n${changed} package(s) match generated publish configuration.`
    : `\n${changed} package(s) synced. Run \`pnpm build:libs\` to produce dist/.`,
);
