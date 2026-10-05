import { readFileSync } from 'node:fs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import * as preparation from './entry-preparation.ts';

interface NativeRow {
  args: string[];
  options: Record<string, unknown>;
  filter: string[];
}
const oracle = JSON.parse(
  readFileSync(
    new URL(
      '../../../../docs/backlog/runtime-js/reference/vitest-cli-admission-oracle.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { rows: NativeRow[] };
function files() {
  const fs = new MemoryFsSync();
  fs.loadFixture({
    '/node_modules/.bin/vitest': "#!/usr/bin/env node\nimport('../vitest/vitest.mjs');",
    '/node_modules/vitest/package.json': JSON.stringify({
      name: 'vitest',
      version: '4.1.11',
      bin: './vitest.mjs',
    }),
    '/node_modules/vitest/vitest.mjs': 'export {};',
    '/node_modules/vite/package.json': JSON.stringify({ name: 'vite', version: '8.0.16' }),
  });
  return fs;
}
interface AdmissionOptions {
  fs: MemoryFsSync;
  specifier: string;
  fromFile: string;
  args: readonly string[];
  importModule: (specifier: string, fromFile: string) => Promise<unknown>;
}
type Admit = (options: AdmissionOptions) => Promise<undefined | 'handled'>;
function admit(): Admit {
  const method = Reflect.get(preparation, 'admitInstalledCliEntry') as Admit;
  expect(typeof method).toBe('function');
  return method;
}
// External Vitest parser boundary only; frozen Node 24 / exact 4.1.11 projection.
function parser(row: NativeRow) {
  return async () => ({
    parseCLI: (argv: readonly string[]) => {
      expect(argv).toEqual(['vitest', ...row.args]);
      return { options: row.options, filter: row.filter };
    },
  });
}

describe('installed CLI admission', () => {
  it.each([
    ['vitest', '4.1.10', 'vitest.version'],
    ['vite', '8.0.15', 'vitest.vite-version'],
  ])('rejects another %s version before loading the CLI', async (name, version, feature) => {
    const fs = files();
    fs.loadFixture({
      [`/node_modules/${name}/package.json`]: JSON.stringify({
        name,
        version,
        ...(name === 'vitest' ? { bin: './vitest.mjs' } : {}),
      }),
    });
    await expect(
      admit()({
        fs,
        specifier: '/node_modules/vitest/vitest.mjs',
        fromFile: '/node_modules/vitest/vitest.mjs',
        args: ['run'],
        importModule: async () => {
          throw new Error('unexpected parser import');
        },
      }),
    ).rejects.toMatchObject({ name: 'NotImplementedError', feature });
  });
  for (const row of oracle.rows) {
    it(JSON.stringify(row.args), async () => {
      const opts = {
        fs: files(),
        specifier: '../vitest/vitest.mjs',
        fromFile: '/node_modules/.bin/vitest',
        args: row.args,
        importModule: parser(row),
      };
      const enabled = (value: unknown) =>
        typeof value === 'object' && value !== null && Reflect.get(value, 'enabled') === true;
      const allowed =
        row.args[0] === 'run' &&
        !row.options.watch &&
        !enabled(row.options.coverage) &&
        !enabled(row.options.browser) &&
        !['jsdom', 'happy-dom'].includes(String(row.options.environment)) &&
        !['vmThreads', 'vmForks'].includes(String(row.options.pool));
      if (allowed) await expect(admit()(opts)).resolves.toBeUndefined();
      else await expect(admit()(opts)).rejects.toMatchObject({ name: 'NotImplementedError' });
    });
  }
  it('checks declared bin identity; arbitrary user files keep generic execution', async () => {
    const fs = files();
    fs.loadFixture({ '/user/vitest': 'export {};' });
    await expect(
      admit()({
        fs,
        specifier: '/user/vitest',
        fromFile: '/user/vitest',
        args: ['--watch'],
        importModule: async () => {
          throw new Error('unexpected parser import');
        },
      }),
    ).resolves.toBeUndefined();
  });
  it('checks canonical direct entry too', async () => {
    const row = oracle.rows.find((row) => row.args.join(' ') === '--watch')!;
    await expect(
      admit()({
        fs: files(),
        specifier: '/node_modules/vitest/vitest.mjs',
        fromFile: '/node_modules/vitest/vitest.mjs',
        args: row.args,
        importModule: parser(row),
      }),
    ).rejects.toMatchObject({ feature: 'vitest.watch' });
  });
});

it.each(['--help', '-h', '--version', '-v'])(
  'root info %s reaches unchanged CLI without helper output',
  async (arg) => {
    await expect(
      admit()({
        fs: files(),
        specifier: '../vitest/vitest.mjs',
        fromFile: '/node_modules/.bin/vitest',
        args: [arg],
        importModule: async () => {
          throw new Error('information must not be printed twice');
        },
      }),
    ).resolves.toBeUndefined();
  },
);
it('native canonical help is handled without a second CLI import', async () => {
  await expect(
    admit()({
      fs: files(),
      specifier: '../vitest/vitest.mjs',
      fromFile: '/node_modules/.bin/vitest',
      args: ['run', '--help'],
      importModule: async () => ({ parseCLI: () => ({ options: { help: true, run: true } }) }),
    }),
  ).resolves.toBe('handled');
});
