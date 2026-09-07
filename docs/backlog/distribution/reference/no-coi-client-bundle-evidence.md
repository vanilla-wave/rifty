# no-COI client bundle evidence (2026-09-06)

Measured on PR #304 branch @ `edb8e1379` (main @ `365812dbf` carries the same
graph). esbuild 0.28.0 from repo `node_modules`; `bundle`, `minify`,
`target: chrome148`, `platform: browser`, `metafile`; gz = `zlib.gzipSync`
default level. "source" resolves workspace `src/*`; "dist" resolves
`publishConfig.exports` after `pnpm build:libs` (tsup).

## Artifacts

| artifact | source min / gz | dist min / gz |
|---|---|---|
| sdk main — `import { createSandbox } from '@riftydev/sdk'` | 57 / 17 KB | 101 / 29 KB |
| `@riftydev/service-worker/sw` | 13 / 5 KB | 62 / 18 KB |
| `@riftydev/workbench/no-coi-toolchain-worker` | 4506 / 1304 KB | 4471 / 1297 KB |
| QuickJS `emscripten-module.wasm`, fetched at every worker boot/restart | 503 134 B / 232 373 B gz | — |
| install-time: `esbuild-wasm/esbuild.wasm` (shadow substitution) | 13 918 738 B / 3 761 200 B gz | — |

## no-COI worker composition (source run, min)

| KB | input |
|---|---|
| 3489 | `typescript/lib/typescript.js` |
| 376 | `@riftydev/runtime-js` |
| 119 | `acorn` |
| 93 | `@riftydev/workbench` (73 = `workers/generated/esbuild-runtime.js`) |
| 80 | `@riftydev/npm-client` |
| 75 | `@riftydev/net` |
| 62 | `@riftydev/kernel` (31 = `process-manager.ts`) |
| 55 | `@riftydev/io` |
| 52 | `quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-sync` (JS glue) |
| 32 | `cjs-module-lexer` |
| 29 | `@riftydev/vfs` |
| 24 | `tools/shadow-registry` (catalog json 15 + codec 9) |
| 13 | `@riftydev/runtime-wasi` |

What-if `typescript` external: 999 KB min / 294 KB gz. `typescript` + `acorn`
external: 881 / 261 KB. Generic runtime worker
(`packages/runtime-js/src/worker-entry.ts`): 4202 / 1213 KB; `typescript`
external: 702 / 205 KB.

Both scripts below run without `splitting`, so `import()` boundaries are
inlined into one output; post-change measurements must use `splitting: true`
and read the eager boot chunk's metafile inputs (see
`toolchain-build/client-bundle-size-ci-gate`).

## Import chains (metafile BFS from the worker entry)

```
typescript:  no-coi-toolchain-worker.ts → runtime-js/builtins/node-entry.ts → module-loader/loader.ts → typescript/lib/typescript.js
kernel:      no-coi-toolchain-worker.ts → runtime-js/builtins/process.ts → kernel/src/index.ts → kernel/src/process-manager.ts
quickjs:     no-coi-toolchain-worker.ts → runtime-js/worker-entry.ts → builtins/vm/quickjs-loader.ts → quickjs-emscripten-core
npm-client:  no-coi-toolchain-worker.ts → npm-client/src/index.ts → linker.ts → tools/shadow-registry/src/internal/codec.ts → generated/shadow-substitution-catalog.json
esbuild rt:  no-coi-toolchain-worker.ts → workbench/workers/workbench-runtime-adapters.ts → workers/generated/esbuild-runtime.js
```

`typescript` static import entered `loader.ts` in `5289f38ea` (2026-07-30,
"Node CLI eval identity parity"); PR #304 does not touch that usage. Its only
uses: `requiresTypeScriptEvalContext` (loader.ts:462, called from
`runNodeEvalScript` :754), `nodeEvalConstBindingMarker` (:311, error path),
`tsconfig-paths.ts` (opt-in `autoDiscoverTsconfigPaths`, default off).
`.ts` execution never uses it: `transformSource` hook is host-injected
(ADR-0052) and the no-COI worker injects none.

## io dist retention

```
import { NotImplementedError } from './packages/io/dist/index.js'  → 48.2 KB min
import { registerBuiltin }      from './packages/io/dist/index.js'  → 48.3 KB min
```

Kept by top-level `installCoreMethods(Buffer)` / `installIntMethods` /
`installExtraMethods` (`io/src/buffer.ts:403-405`) and
`Object.setPrototypeOf(Stream…)`; `sideEffects: false` cannot drop statements
inside one file. Consumers on the main/sw path: `service-worker/src/
{body-transport,preview-bridge,route-preview}.ts`, `net/src/cross-realm/
preview-port.ts`, `runtime-js/src/host.ts`.

## sideEffects src entry

`packages/workbench/package.json` `sideEffects` lists
`./src/workers/kernel-worker-entry.ts` and `./dist/no-coi-toolchain-worker.js`
but not `./src/workers/no-coi-toolchain-worker.ts`. esbuild stdin
`import './src/workers/no-coi-toolchain-worker.ts'` (resolveDir
`packages/workbench`) → output 0 KB.

## QuickJS preload call sites

```
packages/runtime-js/src/worker-entry.ts:139          await ensureVmEngineReady();            // unconditional
packages/runtime-js/src/ipc/install-process.ts:125   if (resolveVmEngineName() === 'quickjs') return ensureVmEngineReady()…
```

`RuntimeOptions.vmEngine` (host.ts:33) is sent as `vm-config`;
`ToolchainCreateSandboxOptions` has no such field and `bootToolchainSandbox`
calls `spawnToolchainRuntime({ workerUrl })` only.

## Scripts

Source run (`node measure.mjs` from repo root; `E` = `node_modules/esbuild/lib/main.js`):

```js
import { build } from './node_modules/esbuild/lib/main.js';
import { gzipSync } from 'node:zlib';
const common = { bundle: true, format: 'esm', platform: 'browser', target: 'chrome148',
  write: false, metafile: true, minify: true, loader: { '.wasm': 'file' }, outdir: '/tmp/out' };
const entries = {
  main: { stdin: { contents: `import { createSandbox } from './src/index.ts'; export { createSandbox };`,
          resolveDir: 'packages/rifty', loader: 'ts' } },
  worker: { entryPoints: ['packages/workbench/src/workers/no-coi-toolchain-worker.ts'] },
  sw: { entryPoints: ['packages/service-worker/src/sw.ts'] },
};
for (const [name, opts] of Object.entries(entries)) {
  const r = await build({ ...common, ...opts });
  const out = Object.values(r.metafile.outputs).find((o) => o.inputs && Object.keys(o.inputs).length);
  const js = r.outputFiles.find((f) => f.path.endsWith('.js')).contents;
  console.log(name, (js.length / 1024).toFixed(0), 'KB min', (gzipSync(js).length / 1024).toFixed(0), 'KB gz');
  const by = new Map();
  for (const [k, v] of Object.entries(out.inputs)) {
    const g = k.match(/^packages\/([^/]+)\//)?.[1] ?? k.match(/node_modules\/\.pnpm\/([^/]+)\//)?.[1] ?? k;
    by.set(g, (by.get(g) ?? 0) + v.bytesInOutput);
  }
  for (const [g, b] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log('  ', (b / 1024).toFixed(0), 'KB', g);
}
```

Dist run: same, with an `onResolve` plugin mapping `@riftydev/<pkg>[/sub]` to
`<pkg dir>/<publishConfig.exports[sub].import>` after `pnpm build:libs`, and
stdin `import { createSandbox } from '@riftydev/sdk'` /
`import '@riftydev/workbench/no-coi-toolchain-worker'` /
`import '@riftydev/service-worker/sw'`.
