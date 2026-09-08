#!/usr/bin/env node
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Published copyable Workbench runtime closure (ADR-0395). tsup leaves
 * @riftydev/* external; this step emits fully bundled workers/SW plus WASM.
 */
import { build } from 'esbuild';

const workbenchRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(workbenchRoot, '../..');
const outdir = resolve(workbenchRoot, 'dist/runtime');
const requireRuntimeJs = createRequire(resolve(repoRoot, 'packages/runtime-js/package.json'));
const requireNet = createRequire(resolve(repoRoot, 'packages/net/package.json'));

const RUNTIME_SCRIPTS = [
  ['owner-worker.js', resolve(workbenchRoot, 'src/workers/workbench-owner-bootstrap.ts')],
  ['kernel-worker.js', resolve(workbenchRoot, 'src/workers/kernel-worker-entry.ts')],
  ['node-worker.js', resolve(workbenchRoot, 'src/workers/node-entry-bootstrap.ts')],
  ['dev-server-worker.js', resolve(workbenchRoot, 'src/workers/dev-server-child-bootstrap.ts')],
  ['typescript-worker.js', resolve(workbenchRoot, 'src/workers/ts-lsp-worker-entry.ts')],
  ['no-coi-toolchain-worker.js', resolve(workbenchRoot, 'src/workers/no-coi-toolchain-worker.ts')],
];

const runtimeJsBuiltin = (name) => resolve(repoRoot, `packages/runtime-js/src/builtins/${name}.ts`);

const HOST_BUILTIN_ALIASES = {
  os: runtimeJsBuiltin('os'),
  'node:os': runtimeJsBuiltin('os'),
  path: runtimeJsBuiltin('path'),
  'node:path': runtimeJsBuiltin('path'),
  fs: runtimeJsBuiltin('fs'),
  'node:fs': runtimeJsBuiltin('fs'),
  perf_hooks: runtimeJsBuiltin('perf_hooks'),
  'node:perf_hooks': runtimeJsBuiltin('perf_hooks'),
};

const KERNEL_BANNER =
  "globalThis.__RIFTY_QUICKJS_WASM_URL = new URL('./quickjs.wasm', import.meta.url).href;\n";

const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Service-Worker-Allowed': '/',
};

const FILES = [...RUNTIME_SCRIPTS.map(([name]) => name), 'sw.js', 'sqlite.wasm', 'quickjs.wasm'];

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const shared = {
  absWorkingDir: repoRoot,
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  minify: false,
  alias: HOST_BUILTIN_ALIASES,
  external: ['node:module'],
  logLevel: 'warning',
};

for (const [name, entry] of RUNTIME_SCRIPTS) {
  await build({
    ...shared,
    entryPoints: [entry],
    outfile: resolve(outdir, name),
    format: 'esm',
    banner: name === 'kernel-worker.js' ? { js: KERNEL_BANNER } : undefined,
  });
}

await build({
  ...shared,
  entryPoints: [resolve(repoRoot, 'packages/service-worker/src/sw.ts')],
  outfile: resolve(outdir, 'sw.js'),
  format: 'iife',
});

copyFileSync(requireNet.resolve('sql.js/dist/sql-wasm.wasm'), resolve(outdir, 'sqlite.wasm'));
copyFileSync(
  requireRuntimeJs.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'),
  resolve(outdir, 'quickjs.wasm'),
);

writeFileSync(
  resolve(outdir, 'manifest.json'),
  `${JSON.stringify({ files: FILES, headers: HEADERS }, null, 2)}\n`,
);
