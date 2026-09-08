import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Metafile, build } from 'esbuild';
import { describe, expect, it } from 'vitest';

function staticClosure(meta: Metafile, roots: readonly string[]): Set<string> {
  const pending = [...roots];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    for (const edge of meta.outputs[path]?.imports ?? []) {
      if (!edge.external && edge.kind !== 'dynamic-import') pending.push(edge.path);
    }
  }
  return seen;
}

function compilerOutputs(meta: Metafile): string[] {
  return Object.entries(meta.outputs)
    .filter(([, output]) =>
      Object.keys(output.inputs).some((input) =>
        /(?:typescript\/lib\/typescript|generated\/typescript-browser)\.js$/u.test(input),
      ),
    )
    .map(([path]) => path);
}

describe('client compiler loading', () => {
  it('failed tsconfig preload keeps default and explicit paths usable without publishing readiness', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'rifty-preload-fault-'));
    try {
      const result = await build({
        stdin: {
          contents: `
import * as api from './packages/runtime-js/src/module-loader/index.ts';
import { runNodeEntry } from './packages/runtime-js/src/builtins/node-entry.ts';
import { MemoryFsSync } from './packages/vfs/src/internal/index.ts';
export { api, runNodeEntry, MemoryFsSync };
`,
          resolveDir: process.cwd(),
          sourcefile: 'preload-entry.ts',
          loader: 'ts',
        },
        bundle: true,
        splitting: true,
        format: 'esm',
        platform: 'browser',
        metafile: true,
        outdir: root,
        outExtension: { '.js': '.mjs' },
      });
      const chunks = compilerOutputs(result.metafile);
      expect(chunks.length).toBeGreaterThan(0);
      const entry = Object.entries(result.metafile.outputs).find(
        ([, output]) => output.entryPoint === 'preload-entry.ts',
      )?.[0];
      if (entry === undefined) throw new Error('missing preload entry');
      expect(chunks.filter((path) => staticClosure(result.metafile, [entry]).has(path))).toEqual(
        [],
      );
      for (const chunk of chunks) await rm(resolve(chunk));
      const runner = resolve(root, 'runner.mjs');
      await writeFile(
        runner,
        `
import {api,runNodeEntry,MemoryFsSync} from ${JSON.stringify(pathToFileURL(resolve(entry)).href)};
const vfs = new MemoryFsSync();
vfs.loadFixture({'/work/value.js':'module.exports=42;'});
await runNodeEntry({kind:'eval',vfs,cwd:'/work',source:'globalThis.__preloadJs=42',print:false,explicitCommonJs:false});
let error;
if (typeof api.preloadTsconfigPaths !== 'function') error={message:'preloadTsconfigPaths export missing',cause:''};
else try { await api.preloadTsconfigPaths(); } catch (failure) { error={message:failure.message,cause:String(failure.cause)}; }
let code;
try { api.createModuleLoader(vfs,{autoDiscoverTsconfigPaths:true}); } catch (failure) { code=failure.code; }
const value=api.createModuleLoader(vfs).require('./value.js','/work/main.js');
const explicit=api.createModuleLoader(vfs,{paths:{value:'/work/value.js'}}).require('value','/work/main.js');
console.log(JSON.stringify({error,code,value,explicit,js:globalThis.__preloadJs}));
process.exit(0);
`,
      );
      const output = JSON.parse(
        execFileSync(process.execPath, [runner], {
          encoding: 'utf8',
          timeout: 10_000,
        }),
      );
      expect(output.error?.message).toMatch(/TypeScript compiler chunk failed to load/u);
      expect(output.error?.cause).toMatch(/Cannot find module/u);
      expect(output.code).toBe('TSCONFIG_NOT_READY');
      expect([output.value, output.explicit, output.js]).toEqual([42, 42, 42]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    'packages/runtime-js/src/worker-entry.ts',
    'packages/workbench/src/workers/no-coi-toolchain-worker.ts',
  ])('keeps TypeScript outside the complete boot graph of %s', async (entry) => {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      metafile: true,
      outdir: '/tmp/rifty-compiler-boot-proof',
    });
    // Workbench dynamically imports runtime worker unconditionally during boot.
    const roots = Object.entries(result.metafile.outputs)
      .filter(([, output]) =>
        [entry, 'packages/runtime-js/src/worker-entry.ts'].includes(output.entryPoint ?? ''),
      )
      .map(([path]) => path);
    const eager = staticClosure(result.metafile, roots);
    expect(compilerOutputs(result.metafile).length).toBeGreaterThan(0);
    expect(roots.length).toBeGreaterThan(0);
    expect(compilerOutputs(result.metafile).filter((path) => eager.has(path))).toEqual([]);
  });

  it('runs JS with the compiler chunk unavailable and loudly rejects the first non-JS eval', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'rifty-lazy-eval-'));
    try {
      const result = await build({
        stdin: {
          contents: `
import { runNodeEntry } from './packages/runtime-js/src/builtins/node-entry.ts';
import { MemoryFsSync } from './packages/vfs/src/internal/index.ts';
export async function evaluate(source) {
  await runNodeEntry({ kind: 'eval', vfs: new MemoryFsSync(), cwd: '/work',
    source, print: false, explicitCommonJs: false });
}
`,
          resolveDir: process.cwd(),
          sourcefile: 'eval-entry.ts',
          loader: 'ts',
        },
        bundle: true,
        splitting: true,
        format: 'esm',
        platform: 'browser',
        metafile: true,
        outdir: root,
        outExtension: { '.js': '.mjs' },
      });
      const compilerChunks = compilerOutputs(result.metafile);
      expect(compilerChunks.length).toBeGreaterThan(0);
      const entry = Object.entries(result.metafile.outputs).find(
        ([, output]) => output.entryPoint === 'eval-entry.ts',
      )?.[0];
      if (entry === undefined) throw new Error('missing eval entry');
      expect(
        compilerChunks.filter((path) => staticClosure(result.metafile, [entry]).has(path)),
      ).toEqual([]);
      const runner = resolve(root, 'runner.mjs');
      await writeFile(
        runner,
        `
import { evaluate } from ${JSON.stringify(pathToFileURL(resolve(entry)).href)};
const pending = evaluate('globalThis.__lazyResult = 42');
if (globalThis.__lazyResult !== 42) throw new Error('JS execution was delayed');
await pending;
try { await evaluate('const value: number = 1'); throw new Error('TS unexpectedly executed'); }
catch (error) { console.log(JSON.stringify({message:error.message, cause:String(error.cause)})); }
process.exit(0);
`,
      );
      // Missing output file is a real failed ESM chunk load, not a fake compiler.
      for (const path of compilerChunks) {
        expect((await readFile(resolve(path))).length).toBeGreaterThan(0);
        await rm(resolve(path));
      }
      const output = execFileSync(process.execPath, [runner], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      const error = JSON.parse(output.trim()) as { message: string; cause: string };
      expect(error.message).toMatch(/TypeScript compiler chunk/u);
      expect(error.cause).toMatch(/Cannot find module/u);
      expect(error.cause).toContain('.mjs');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
