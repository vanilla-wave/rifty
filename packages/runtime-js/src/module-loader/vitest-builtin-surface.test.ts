import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from '../builtins/process-bootstrap-identity.ts';
import { NodeProcess } from '../builtins/process.ts';
import { createModuleLoader } from './loader.ts';

it('named process exit retains the active instance receiver', async () => {
  const original = readActiveNodeProcessBootstrap();
  const proc = new NodeProcess();
  setActiveNodeProcessBootstrap(proc);
  const codes: unknown[] = [];
  proc.once('exit', (code) => codes.push(code));
  try {
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/main.mjs': "import {exit} from 'node:process'; export function run(){ exit(7); }",
    });
    const ns = await createModuleLoader(fs).import('/main.mjs');
    expect(() => (ns.run as () => void)()).toThrow(
      expect.objectContaining({ code: 'RIFTY_PROCESS_EXIT', exitCode: 7 }),
    );
    expect(codes).toEqual([7]);
  } finally {
    setActiveNodeProcessBootstrap(original?.process ?? null, original?.federated ?? false);
  }
});

describe('Vitest builtin imports', () => {
  it('links process prototype methods without exporting EventEmitter members', async () => {
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/main.mjs': `
      import process, { cwd, nextTick } from 'node:process';
      import * as ns from 'node:process';
      export const result = [cwd === process.cwd, typeof nextTick, 'on' in ns, 'emit' in ns];
    `,
    });
    const ns = await createModuleLoader(fs).import('/work/main.mjs');
    expect(ns.result).toEqual([true, 'function', false, false]);
  });

  it.each([
    ['node:fs', 'statfsSync', 'fs.statfsSync'],
    ['node:child_process', 'spawnSync', 'child_process.spawnSync'],
    ['node:process', 'memoryUsage', 'process.memoryUsage'],
  ])('links %s.%s and throws a named ceiling on call', async (module, name, feature) => {
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/main.mjs': `import { ${name} } from '${module}'; export { ${name} };`,
    });
    const ns = await createModuleLoader(fs).import('/work/main.mjs');
    expect(typeof ns[name]).toBe('function');
    expect(() => (ns[name] as () => unknown)()).toThrow(expect.objectContaining({ feature }));
  });
});

it.each(['constants.DONT_CONTEXTIFY', 'SourceTextModule', 'SyntheticModule'])(
  'vm.%s has a named loud ceiling',
  async (feature) => {
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/main.mjs': `import vm from 'node:vm'; export function run() { ${feature.startsWith('constants') ? `return vm.${feature};` : `return new vm.${feature}('');`} }`,
    });
    const ns = await createModuleLoader(fs).import('/work/main.mjs');
    expect(() => (ns.run as () => unknown)()).toThrow(
      expect.objectContaining({ feature: `vm.${feature}` }),
    );
  },
);

it('coverage inspector promises is importable and throws its named Session ceiling', async () => {
  const fs = new MemoryFsSync();
  fs.loadFixture({
    '/work/main.mjs':
      "import inspector from 'node:inspector/promises'; export function run(){ return new inspector.Session(); }",
  });
  const ns = await createModuleLoader(fs).import('/work/main.mjs');
  expect(() => (ns.run as () => unknown)()).toThrow(
    expect.objectContaining({ feature: 'inspector/promises.Session' }),
  );
});
