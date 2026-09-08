import assert from 'node:assert/strict';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { hostBuiltinAliases } from './workbench-asset-builtins.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workbench = resolve(root, 'packages/workbench');
const requireWorkbench = createRequire(resolve(workbench, 'package.json'));
const requireRuntime = createRequire(resolve(root, 'packages/runtime-js/package.json'));
const requireNet = createRequire(resolve(root, 'packages/net/package.json'));
const outdir = resolve(workbench, 'dist/assets');
const entries = {
  'owner-worker': '@riftydev/workbench/owner-worker',
  'kernel-worker': './tools/publishing/workbench-kernel-asset.ts',
  'node-worker': '@riftydev/workbench/node-worker',
  'dev-server-worker': '@riftydev/workbench/dev-server-worker',
  'typescript-worker': '@riftydev/workbench/typescript-worker',
  'no-coi-toolchain-worker': '@riftydev/workbench/no-coi-toolchain-worker',
};
const workerResult = await build({
  absWorkingDir: root,
  entryPoints: Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => [
      name,
      entry.startsWith('.') ? resolve(root, entry) : requireWorkbench.resolve(entry),
    ]),
  ),
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  alias: Object.fromEntries(
    Object.entries({
      ...hostBuiltinAliases,
      '@riftydev/workbench/kernel-worker': '@riftydev/workbench/kernel-worker',
      '@riftydev/runtime-js/install-process': '@riftydev/runtime-js/install-process',
    }).map(([name, target]) => [name, requireWorkbench.resolve(target)]),
  ),
  define: { __filename: '"/typescript.js"', __dirname: '"/"' },
  // Node-only fallbacks must disappear from the emitted graph below.
  external: ['node:*'],
  metafile: true,
  write: false,
});
// ADR-0381: unconditional runtime boot must not pull in the eval compiler.
const eager = Object.entries(workerResult.metafile.outputs)
  .filter(([, output]) =>
    [
      'packages/workbench/src/workers/no-coi-toolchain-worker.ts',
      'packages/runtime-js/src/worker-entry.ts',
    ].includes(output.entryPoint),
  )
  .map(([path]) => path);
const visited = new Set();
for (const path of eager) {
  if (visited.has(path)) continue;
  visited.add(path);
  const output = workerResult.metafile.outputs[path];
  assert(
    !Object.keys(output.inputs).some((input) =>
      /(?:typescript\/lib\/typescript|generated\/typescript-browser)\.js$/u.test(input),
    ),
    `Eager Workbench eval compiler: ${path}`,
  );
  for (const edge of output.imports) {
    if (!edge.external && edge.kind !== 'dynamic-import') eager.push(edge.path);
  }
}
// Workbench's native registration uses a classic Service Worker.
const swResult = await build({
  absWorkingDir: root,
  entryPoints: { sw: requireWorkbench.resolve('@riftydev/service-worker/sw') },
  outdir,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  metafile: true,
  write: false,
});
for (const result of [workerResult, swResult]) {
  for (const [path, output] of Object.entries(result.metafile.outputs)) {
    for (const edge of output.imports) {
      assert(!edge.external, `External Workbench asset import: ${path} -> ${edge.path}`);
      assert(result.metafile.outputs[edge.path], `Missing Workbench asset: ${edge.path}`);
    }
  }
}
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
for (const output of [...workerResult.outputFiles, ...swResult.outputFiles]) {
  await mkdir(dirname(output.path), { recursive: true });
  await writeFile(output.path, output.contents);
}
await copyFile(
  requireRuntime.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'),
  resolve(outdir, 'quickjs.wasm'),
);
await copyFile(requireNet.resolve('sql.js/dist/sql-wasm.wasm'), resolve(outdir, 'sql-wasm.wasm'));
