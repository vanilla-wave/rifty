import {
  type MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootBuild, bootPreview } from './build-boot.ts';

// Behavioral heirs of the retired build-boot source greps (epic
// playground-testable-core): the REAL bootBuild/bootPreview run against a
// memory VFS whose node_modules holds a probe `vite` ESM package the runtime-js
// module loader resolves and executes — the probe records the inline config and
// whether the esbuild bridge was already installed at vite import time.

interface ViteProbe {
  bridgeAtViteImport?: string;
  calls: { kind: 'build' | 'preview'; config: unknown }[];
  previewCloseCalls: number;
}

interface TestGlobals {
  __riftyTestViteProbe?: ViteProbe;
  __riftyEsbuildTransform?: unknown;
}
const g = globalThis as TestGlobals;

const PROBE_VITE_PACKAGE = [
  'const probe = globalThis.__riftyTestViteProbe;',
  'probe.bridgeAtViteImport = typeof globalThis.__riftyEsbuildTransform;',
  'export async function build(config) {',
  "  probe.calls.push({ kind: 'build', config });",
  '}',
  'export async function preview(config) {',
  "  probe.calls.push({ kind: 'preview', config });",
  '  return { httpServer: { close(cb) { probe.previewCloseCalls += 1; if (cb) cb(); } } };',
  '}',
].join('\n');

const BUILT_INDEX_HTML =
  '<!doctype html><html><head><script type="module" src="/assets/index-C7GNvsbY.js"></script></head><body></body></html>';

function probe(): ViteProbe {
  const current = g.__riftyTestViteProbe;
  if (!current) throw new Error('vite probe not installed');
  return current;
}

function bootFixture(
  options: { dist?: string | null; files?: Record<string, string> } = {},
): MemoryFsSync {
  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  const dist = options.dist === undefined ? BUILT_INDEX_HTML : options.dist;
  fsSync.loadFixture({
    '/app/package.json': JSON.stringify({ name: 'app', type: 'module' }),
    '/app/node_modules/vite/package.json': JSON.stringify({
      name: 'vite',
      version: '7.0.0',
      type: 'module',
      main: 'index.js',
    }),
    '/app/node_modules/vite/index.js': PROBE_VITE_PACKAGE,
    ...(dist === null ? {} : { '/app/dist/index.html': dist }),
    ...options.files,
  });
  return fsSync;
}

function walkTree(fsSync: MemoryFsSync, dir: string, out: string[] = []): string[] {
  for (const entry of fsSync.readdirSync(dir)) {
    const path = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`;
    out.push(path);
    if (entry.isDirectory) walkTree(fsSync, path, out);
  }
  return out;
}

const savedPwd = process.env.PWD;
beforeEach(() => {
  g.__riftyTestViteProbe = { calls: [], previewCloseCalls: 0 };
});
afterEach(() => {
  g.__riftyTestViteProbe = undefined;
  g.__riftyEsbuildTransform = undefined;
  // (`= undefined` would store the string "undefined" in a real node env)
  if (savedPwd === undefined) Reflect.deleteProperty(process.env, 'PWD');
  else process.env.PWD = savedPwd;
  resetSyncMirror();
});

describe('bootBuild — curated production build', () => {
  it('drives vite.build with the forced inline config: absolute base /, no config file, dist outDir', async () => {
    bootFixture();
    const logs: string[] = [];
    await bootBuild({ root: '/app', log: (chunk) => logs.push(chunk) });

    expect(probe().calls).toEqual([
      {
        kind: 'build',
        config: {
          root: '/app',
          base: '/',
          configFile: false,
          clearScreen: false,
          logLevel: 'info',
          build: { outDir: 'dist', emptyOutDir: true },
        },
      },
    ]);
    expect(logs).toEqual([
      '[vite] production build starting\n',
      '[vite] production build complete\n',
    ]);
  });

  it('installs the shared esbuild WASI transform bridge BEFORE vite is imported', async () => {
    bootFixture();
    await bootBuild({ root: '/app', log: () => {} });
    // Captured by the probe package's MODULE BODY — i.e. at vite import time.
    expect(probe().bridgeAtViteImport).toBe('function');
  });

  it('loud-rejects a user vite.config before importing or running vite', async () => {
    bootFixture({ files: { '/app/vite.config.ts': 'export default {};\n' } });
    await expect(bootBuild({ root: '/app', log: () => {} })).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'vite.config-loading',
    });
    expect(probe().calls).toEqual([]);
    expect(probe().bridgeAtViteImport).toBeUndefined();
  });

  it('refuses a build whose dist/index.html never references built assets', async () => {
    bootFixture({ dist: '<!doctype html><html><body>hello</body></html>' });
    await expect(bootBuild({ root: '/app', log: () => {} })).rejects.toThrow(
      'vite build completed but dist/index.html does not reference built assets',
    );
  });

  it('refuses malformed .assets/ paths in the built index.html', async () => {
    bootFixture({ dist: '<script type="module" src=".assets/index-C7GNvsbY.js"></script>' });
    await expect(bootBuild({ root: '/app', log: () => {} })).rejects.toThrow(
      'vite build completed but dist/index.html references malformed .assets/ paths',
    );
  });

  it('writes zero shim glue into the project — internals shims are install-time (ADR-0188)', async () => {
    const fsSync = bootFixture();
    const before = walkTree(fsSync, '/').sort();
    await bootBuild({ root: '/app', log: () => {} });
    expect(walkTree(fsSync, '/').sort()).toEqual(before);
  });
});

describe('bootPreview — curated preview of the built dist', () => {
  it('validates the built dist BEFORE importing vite: missing dist/index.html is loud', async () => {
    bootFixture({ dist: null });
    await expect(bootPreview({ root: '/app', port: 4173, log: () => {} })).rejects.toThrow(
      'vite build completed but dist/index.html is missing',
    );
    expect(probe().calls).toEqual([]);
  });

  it('loud-rejects a user vite.config', async () => {
    bootFixture({ files: { '/app/vite.config.mjs': 'export default {};\n' } });
    await expect(bootPreview({ root: '/app', port: 4173, log: () => {} })).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'vite.config-loading',
    });
  });

  it('drives vite.preview with the forced inline config and stops the http server on stop()', async () => {
    bootFixture();
    const logs: string[] = [];
    const handle = await bootPreview({
      root: '/app',
      port: 5199,
      log: (chunk) => logs.push(chunk),
    });

    expect(probe().calls).toEqual([
      {
        kind: 'preview',
        config: {
          root: '/app',
          base: '/',
          configFile: false,
          clearScreen: false,
          logLevel: 'info',
          preview: { port: 5199, strictPort: true, host: true },
        },
      },
    ]);
    expect(handle.port).toBe(5199);
    expect(logs).toEqual([
      '[vite] preview starting on port 5199\n',
      '[vite] preview ready on port 5199\n',
    ]);

    await handle.stop();
    expect(probe().previewCloseCalls).toBe(1);
  });
});
