import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { riftyProcess } from '@riftydev/runtime-js/builtins/process';
import { ref, unref } from '@riftydev/runtime-js/internal';
import { builtinShadowSubstitutionCatalog } from '@riftydev/shadow-registry/internal';
import {
  ESBUILD_RUNTIME_ADAPTER_ID,
  activatePackageRuntimeAdapters,
} from '@riftydev/shadow-registry/runtime';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { expect, it } from 'vitest';
import { runNoCoiProjectCommand } from './no-coi-project-command.ts';

const require = createRequire(
  new URL('../../../../tools/shadow-registry/package.json', import.meta.url),
);

it('uses each fresh Node invocation cwd for esbuild, preserving its imported cwd after chdir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rifty-esbuild-command-cwd-'));
  const previousProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const previousRegistry = Object.getOwnPropertyDescriptor(globalThis, '__riftyShadowRegistry');
  const entry = `
    const esbuild = require('esbuild');
    const options = { entryPoints: ['./input.js'], write: false, logLevel: 'silent' };
    esbuild.build(options).then(async (first) => {
      process.chdir(process.cwd().endsWith('/sub') ? '..' : './sub');
      if (require('esbuild') !== esbuild) throw new Error('changed CJS identity');
      const second = await esbuild.build(options);
      console.log(JSON.stringify([first.outputFiles[0].text, second.outputFiles[0].text]));
    });
  `;
  const entries = [
    { cwd: '.', source: entry },
    { cwd: 'sub', source: entry },
    { cwd: '.', source: `process.chdir('sub'); ${entry}` },
    {
      cwd: '.',
      source: `require('esbuild').build({ entryPoints: ['./missing.js'], write: false, logLevel: 'silent' }).catch(() => console.log('caught'));`,
    },
    { cwd: 'sub', source: entry },
  ];
  try {
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'input.js'), 'console.log("root")');
    writeFileSync(join(root, 'sub/input.js'), 'console.log("sub")');
    const native = entries.map(({ cwd, source }) =>
      execFileSync(
        process.execPath,
        [
          '-e',
          source.replaceAll("require('esbuild')", 'require(process.argv[1])'),
          require.resolve('esbuild'),
        ],
        {
          cwd: join(root, cwd),
          encoding: 'utf8',
        },
      ),
    );
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project/sub', { recursive: true });
    fs.mkdirSync('/project/node_modules/esbuild-wasm', { recursive: true });
    fs.loadFixture({
      '/project/input.js': 'console.log("root")',
      '/project/sub/input.js': 'console.log("sub")',
      '/project/entry.cjs': entry,
    });
    fs.writeFileSync(
      '/project/node_modules/esbuild-wasm/esbuild.wasm',
      readFileSync(require.resolve('esbuild-wasm/esbuild.wasm')),
    );
    const recipe = builtinShadowSubstitutionCatalog.recipes.find(
      (candidate) => candidate.id === 'rifty.shadow-substitution.esbuild.v2',
    );
    if (!recipe) throw new Error('missing esbuild recipe');
    for (const file of recipe.materialization.files) {
      const path = `/project/node_modules/esbuild/${file.path}`;
      fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      fs.writeFileSync(path, new TextEncoder().encode(file.content));
    }
    Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
    await activatePackageRuntimeAdapters({
      bindings: [
        {
          adapterId: ESBUILD_RUNTIME_ADAPTER_ID,
          packagePath: '/project/node_modules/esbuild-wasm',
        },
      ],
      fs,
      cwd: '/project',
      getCwd: () => riftyProcess.cwd(),
      refs: { ref, unref },
    });
    setSyncMirror(fs);
    Object.defineProperty(globalThis, 'process', { configurable: true, value: riftyProcess });
    fs.writeFileSync(
      '/project/context.cjs',
      new TextEncoder().encode(`
      require('esbuild').context({ entryPoints: ['./input.js'], write: false, logLevel: 'silent' })
        .then(context => {
          globalThis.__riftyTestEsbuildContext = context;
          console.log('context ready');
        });
    `),
    );
    let ready!: () => void;
    const atContext = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let settled = false;
    const completion = runNoCoiProjectCommand(
      { project: { root: '/project' }, cwd: '/project', env: {}, command: 'node context.cjs' },
      new AbortController().signal,
      { fs, flush: async () => 'memory', effects: () => 'unknown', onOutput: () => ready() },
    ).then((result) => {
      settled = true;
      return result;
    });
    await atContext;
    const contextGlobal = globalThis as typeof globalThis & {
      __riftyTestEsbuildContext?: { dispose(): Promise<void> };
    };
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
    } finally {
      await contextGlobal.__riftyTestEsbuildContext?.dispose();
      Reflect.deleteProperty(contextGlobal, '__riftyTestEsbuildContext');
    }
    expect(await completion).toMatchObject({ status: 'exited', exitCode: 0 });
    const actual: string[] = [];
    for (const { cwd, source } of entries) {
      fs.writeFileSync('/project/entry.cjs', new TextEncoder().encode(source));
      let stdout = '';
      let stderr = '';
      const result = await runNoCoiProjectCommand(
        {
          project: { root: '/project' },
          cwd: `/project/${cwd}`,
          env: {},
          command: 'node /project/entry.cjs',
        },
        new AbortController().signal,
        {
          fs,
          flush: async () => 'memory',
          effects: () => 'unknown',
          onOutput(chunk, stream) {
            if (stream === 'stdout') stdout += chunk;
            else stderr += chunk;
          },
        },
      );
      expect({ ...result, stderr }).toMatchObject({ status: 'exited', exitCode: 0, stderr: '' });
      actual.push(stdout);
    }
    expect(actual).toEqual(native);
  } finally {
    resetSyncMirror();
    if (previousProcess) Object.defineProperty(globalThis, 'process', previousProcess);
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else Reflect.deleteProperty(globalThis, 'self');
    if (previousRegistry)
      Object.defineProperty(globalThis, '__riftyShadowRegistry', previousRegistry);
    else Reflect.deleteProperty(globalThis, '__riftyShadowRegistry');
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
