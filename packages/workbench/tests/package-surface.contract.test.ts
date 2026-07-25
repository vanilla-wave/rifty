import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const EXPECTED_DEV_EXPORTS = {
  '.': './src/index.ts',
  './playground': './src/workbench/playground.ts',
  './owner-worker': './src/workers/workbench-owner-bootstrap.ts',
  './kernel-worker': './src/workers/kernel-worker-entry.ts',
  './node-worker': './src/workers/node-entry-bootstrap.ts',
  './dev-server-worker': './src/workers/dev-server-child-bootstrap.ts',
  './typescript-worker': './src/workers/ts-lsp-worker-entry.ts',
} as const;

const EXPECTED_PUBLISHED_EXPORTS = Object.fromEntries(
  Object.keys(EXPECTED_DEV_EXPORTS).map((subpath) => {
    const entry = subpath === '.' ? 'index' : subpath.slice(2);
    return [
      subpath,
      {
        types: `./dist/${entry}.d.ts`,
        import: `./dist/${entry}.js`,
      },
    ];
  }),
);

interface WorkbenchManifest {
  readonly name: string;
  readonly main: string;
  readonly module: string;
  readonly types: string;
  readonly sideEffects: readonly string[];
  readonly exports: Readonly<Record<string, string>>;
  readonly publishConfig: {
    readonly exports: Readonly<Record<string, { readonly types: string; readonly import: string }>>;
  };
}

async function readManifest(): Promise<WorkbenchManifest> {
  const source = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  return JSON.parse(source) as WorkbenchManifest;
}

describe('@riftydev/workbench package surface', () => {
  it('publishes exactly the root, Playground companion, and five worker entries', async () => {
    const manifest = await readManifest();

    expect(manifest.name).toBe('@riftydev/workbench');
    expect([manifest.main, manifest.module, manifest.types]).toEqual([
      './src/index.ts',
      './src/index.ts',
      './src/index.ts',
    ]);
    expect(manifest.exports).toEqual(EXPECTED_DEV_EXPORTS);
    expect(manifest.publishConfig.exports).toEqual(EXPECTED_PUBLISHED_EXPORTS);
    expect(manifest.sideEffects).toEqual([
      './dist/owner-worker.js',
      './dist/kernel-worker.js',
      './dist/node-worker.js',
      './dist/dev-server-worker.js',
      './dist/typescript-worker.js',
    ]);
  });

  it('does not expose source or internal subpaths', async () => {
    const manifest = await readManifest();
    const subpaths = [
      ...Object.keys(manifest.exports),
      ...Object.keys(manifest.publishConfig.exports),
    ];

    expect(subpaths.some((subpath) => subpath.startsWith('./src/'))).toBe(false);
    expect(subpaths.some((subpath) => subpath.includes('/internal'))).toBe(false);
  });
});
