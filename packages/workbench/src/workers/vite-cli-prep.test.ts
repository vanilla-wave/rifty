import {
  type MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  planViteCliPreparation,
  prepareViteBinSpawnRequest,
  prepareViteCli,
  prepareViteCliAcquisitionFiles,
  viteCliMode,
  viteCliPreparationFromArgs,
} from './vite-cli-prep.ts';
import {
  readPreparedViteConfigSource,
  viteConfigTempPatchApplied,
  viteConfigTempPatchPolicy,
} from './vite-config-temp-patch.ts';
import { decideViteEsbuildRuntime } from './vite-esbuild-runtime.ts';

// Behavioral heirs of the retired vite-cli-prep source greps (epic
// playground-testable-core): file tests drive the pre-runtime preparation over
// memory VFS and execute its output. Only the final fault enters the one-shot
// runtime startup branch.

const dec = new TextDecoder();
const CLI_PATH = '/app/node_modules/vite/dist/node/cli.js';
const CONFIG_PATH = '/app/node_modules/vite/dist/node/chunks/config.js';
const VITE_PACKAGE_JSON = '/app/node_modules/vite/package.json';
const VITE_BIN = '/app/node_modules/.bin/vite';

function viteManifest(version: string): string {
  return JSON.stringify({ name: 'vite', version });
}

async function prepareVite(
  mode: 'dev' | 'build' | 'preview' | 'optimize' | 'info',
  bin = VITE_BIN,
  shadowAssets?: import('@riftydev/npm-client').ShadowAssetRuntimeReader,
): Promise<void> {
  const plan = planViteCliPreparation({ root: '/app', mode, executedBinPath: bin });
  await prepareViteCli(plan, shadowAssets);
}
/** Mirrors the CAC runMatchedCommand call shape of real vite dist/node/cli.js —
 * the keepalive patch's needle. Registers the class on globalThis so the test
 * can drive parse() after executing the patched source. */
const CAC_CALL_SITE = [
  'class TestCac {',
  '  constructor(action) { this.__action = action; }',
  '  runMatchedCommand() { return this.__action(); }',
  '  parse() {',
  '    this.runMatchedCommand();',
  '  }',
  '}',
  'globalThis.__riftyTestCac = TestCac;',
].join('\n');

const CHOKIDAR_DIR_ENTRY_CALL_SITE = [
  'const EMPTY_STR = "";',
  'const ONE_DOT = ".";',
  'const TWO_DOTS = "..";',
  'class TestDirEntry {',
  '  constructor() { this.items = new Set(); }',
  '  add(item) {',
  '    const { items } = this;',
  '    if (!items) return;',
  '    if (item !== ONE_DOT && item !== TWO_DOTS) items.add(item);',
  '  }',
  '}',
  'globalThis.__riftyTestDirEntry = TestDirEntry;',
].join('\n');

interface TestGlobals {
  __rifty?: { esbuild?: unknown };
  __riftyTestCac?: new (action: () => unknown) => { parse(): void };
  __riftyTestDirEntry?: new () => { items: Set<string>; add(item: string): void };
  __riftyTrackCliPromise?: (promise: PromiseLike<unknown>) => void;
}
const g = globalThis as TestGlobals;

function clearEsbuildRuntimeSlot(): void {
  if (g.__rifty) Reflect.deleteProperty(g.__rifty, 'esbuild');
}

function bootFs(files: Record<string, string> = {}): MemoryFsSync {
  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  const fixture: Record<string, string> = { '/app/package.json': '{}', ...files };
  for (const path of Object.keys(fixture)) {
    const suffix = '/dist/node/cli.js';
    if (!path.endsWith(suffix) || !path.includes('/node_modules/vite/')) continue;
    const packageRoot = path.slice(0, -suffix.length);
    const manifestPath = `${packageRoot}/package.json`;
    const chunkPrefix = `${packageRoot}/dist/node/chunks/`;
    const existingChunks = Object.keys(fixture).filter((candidate) =>
      candidate.startsWith(chunkPrefix),
    );
    if (fixture[manifestPath] === undefined) {
      fixture[manifestPath] = viteManifest(
        existingChunks.some((candidate) => candidate === `${chunkPrefix}node.js`)
          ? '8.0.16'
          : '7.3.6',
      );
    }
    const version = (JSON.parse(fixture[manifestPath] ?? '{}') as { readonly version?: unknown })
      .version;
    const sourcePolicy = viteConfigTempPatchPolicy.sources.find(
      (candidate) => candidate.version === version,
    );
    const fixturePolicy =
      sourcePolicy ??
      (typeof version === 'string' && version.startsWith('8.')
        ? viteConfigTempPatchPolicy.sources[1]
        : viteConfigTempPatchPolicy.sources[0]);
    const sourcePath = `${packageRoot}/${fixturePolicy.relativeSourcePath}`;
    if (existingChunks.length === 0) {
      fixture[sourcePath] = `${CHOKIDAR_DIR_ENTRY_CALL_SITE}\n${fixturePolicy.upstreamBlock}`;
      continue;
    }
    if (
      fixture[sourcePath]?.includes('loadConfigFromBundledFile') !== true &&
      fixture[sourcePath]?.includes('if (item !== ONE_DOT && item !== TWO_DOTS)') === true
    ) {
      fixture[sourcePath] = `${fixture[sourcePath]}\n${fixturePolicy.upstreamBlock}`;
    }
  }
  fsSync.loadFixture(fixture);
  return fsSync;
}

function readText(fsSync: MemoryFsSync, path: string): string {
  return dec.decode(fsSync.readFileBytesSync(path));
}

function captureWritePaths(fsSync: MemoryFsSync): string[] {
  const realWrite = fsSync.writeFileSync.bind(fsSync);
  const writes: string[] = [];
  fsSync.writeFileSync = (path, data) => {
    writes.push(path);
    realWrite(path, data);
  };
  return writes;
}

function runPatchedCli(fsSync: MemoryFsSync): void {
  new Function(readText(fsSync, CLI_PATH))();
}

function testCac(): new (action: () => unknown) => { parse(): void } {
  const ctor = g.__riftyTestCac;
  if (!ctor) throw new Error('fixture cli.js did not register TestCac');
  return ctor;
}

function walkTree(fsSync: MemoryFsSync, dir: string, out: string[] = []): string[] {
  for (const entry of fsSync.readdirSync(dir)) {
    const path = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`;
    out.push(path);
    if (entry.isDirectory) walkTree(fsSync, path, out);
  }
  return out;
}

const savedTracker = g.__riftyTrackCliPromise;
afterEach(() => {
  g.__riftyTrackCliPromise = savedTracker;
  g.__riftyTestCac = undefined;
  g.__riftyTestDirEntry = undefined;
  resetSyncMirror();
});

describe('viteCliPreparationFromArgs — executed entry authority', () => {
  it('ignores Vite-shaped argv on a worker_threads entry', () => {
    expect(
      viteCliPreparationFromArgs({
        root: '/app',
        args: [],
        executedBinPath: '/app/node_modules/@rolldown/binding-wasm32-wasi/wasi-worker.mjs',
      }),
    ).toBeNull();
  });

  it.each([VITE_BIN, '/app/node_modules/vite/bin/vite.js'])(
    'decodes the exact installed Vite entry %s',
    (executedBinPath) => {
      expect(
        viteCliPreparationFromArgs({
          root: '/app',
          args: ['preview'],
          executedBinPath,
        }),
      ).toEqual({
        root: '/app',
        mode: 'preview',
        executedBinPath,
      });
    },
  );
});

describe('prepareViteCliAcquisitionFiles — pre-promotion CLI keepalive patch', () => {
  it('module parses and loads (a stray backtick in a template-literal comment breaks the worker fetch)', async () => {
    await expect(import('./vite-cli-prep.ts')).resolves.toBeDefined();
  });

  it('patched CLI hands a detached async action promise to the keepalive tracker', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCliAcquisitionFiles('/app');
    runPatchedCli(fsSync);
    const tracked: unknown[] = [];
    g.__riftyTrackCliPromise = (promise) => {
      tracked.push(promise);
    };
    const action = Promise.resolve('served');
    new (testCac())(() => action).parse();
    expect(tracked).toEqual([action]);
  });

  it('patched CLI leaves synchronous action results untracked and survives an absent tracker', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCliAcquisitionFiles('/app');
    runPatchedCli(fsSync);

    const tracked: unknown[] = [];
    g.__riftyTrackCliPromise = (promise) => {
      tracked.push(promise);
    };
    new (testCac())(() => 'sync-result').parse();
    expect(tracked).toEqual([]);

    g.__riftyTrackCliPromise = undefined;
    expect(() => new (testCac())(() => Promise.resolve()).parse()).not.toThrow();
  });

  it('a second prepare leaves the patched CLI byte-identical (idempotent, still executable)', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCliAcquisitionFiles('/app');
    const once = readText(fsSync, CLI_PATH);
    await prepareViteCliAcquisitionFiles('/app');
    expect(readText(fsSync, CLI_PATH)).toBe(once);
    expect(() => runPatchedCli(fsSync)).not.toThrow();
  });

  it('loud-throws when the vite CLI drops the runMatchedCommand call shape', async () => {
    bootFs({ [CLI_PATH]: 'export function parse() {}' });
    await expect(prepareViteCliAcquisitionFiles('/app')).rejects.toThrow(
      'vite CLI keepalive patch failed: runMatchedCommand call shape not found',
    );
  });

  it('tolerates a project without a vite CLI file without changing child globals', async () => {
    const fsSync = bootFs();
    g.__riftyTrackCliPromise = undefined;
    await prepareViteCliAcquisitionFiles('/app');
    expect(fsSync.existsSync(CLI_PATH)).toBe(false);
    expect(g.__riftyTrackCliPromise).toBeUndefined();
  });
});

describe('prepareViteCliAcquisitionFiles — rooted Chokidar catalog', () => {
  it.each(['config.js', 'node.js'])(
    'rejects the impossible empty self-entry in %s without dropping real root children',
    async (bundle) => {
      const fsSync = bootFs({
        [CLI_PATH]: CAC_CALL_SITE,
        [`/app/node_modules/vite/dist/node/chunks/${bundle}`]: CHOKIDAR_DIR_ENTRY_CALL_SITE,
      });

      await prepareViteCliAcquisitionFiles('/app');
      const once = readText(fsSync, `/app/node_modules/vite/dist/node/chunks/${bundle}`);
      await prepareViteCliAcquisitionFiles('/app');
      expect(readText(fsSync, `/app/node_modules/vite/dist/node/chunks/${bundle}`)).toBe(once);
      new Function(once)();

      const DirEntry = g.__riftyTestDirEntry;
      if (!DirEntry) throw new Error('fixture config.js did not register TestDirEntry');
      const root = new DirEntry();
      root.add('');
      root.add('vite.config.js');

      expect([...root.items]).toEqual(['vite.config.js']);
    },
  );

  it('fails loudly when the bundled Chokidar anchor drifts', async () => {
    bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [CONFIG_PATH]: 'export const changedUpstreamShape = true;',
    });

    await expect(prepareViteCliAcquisitionFiles('/app')).rejects.toThrow(
      /expected exactly one Chokidar DirEntry\.add anchor; found 0/,
    );
  });
});

describe('prepareViteCli — trusted child preparation is read-only', () => {
  it('performs zero VFS writes on the first child launch over a prepared trusted tree', async () => {
    const fsSync = bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: viteManifest('8.0.16'),
    });
    await prepareViteCliAcquisitionFiles('/app');
    const prepared = readText(fsSync, CLI_PATH);
    const writes = captureWritePaths(fsSync);

    await prepareVite('info');

    expect(writes).toEqual([]);
    expect(readText(fsSync, CLI_PATH)).toBe(prepared);
    expect(typeof g.__riftyTrackCliPromise).toBe('function');
  });

  it('loud-rejects an unprepared trusted CLI without silently patching it', async () => {
    const fsSync = bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: viteManifest('8.0.16'),
    });
    const writes = captureWritePaths(fsSync);

    await expect(prepareVite('info')).rejects.toThrow(/before promotion/i);

    expect(writes).toEqual([]);
    expect(readText(fsSync, CLI_PATH)).toBe(CAC_CALL_SITE);
  });

  it('loud-rejects a missing executed CLI without creating node_modules bytes', async () => {
    const fsSync = bootFs({ [VITE_PACKAGE_JSON]: viteManifest('8.0.16') });
    const writes = captureWritePaths(fsSync);

    await expect(prepareVite('info')).rejects.toThrow(/missing prepared CLI/i);

    expect(writes).toEqual([]);
    expect(fsSync.existsSync(CLI_PATH)).toBe(false);
  });
});

describe('prepareViteCliAcquisitionFiles — real Vite config ownership', () => {
  it.each([
    ['7.3.6', 'dist/node/chunks/config.js'],
    ['8.0.16', 'dist/node/chunks/node.js'],
  ] as const)(
    'prepares exact Vite %s backing before promotion and exposes attested bytes from %s',
    async (version, relativeChunk) => {
      const fsSync = bootFs({
        [CLI_PATH]: CAC_CALL_SITE,
        [VITE_PACKAGE_JSON]: viteManifest(version),
      });

      await prepareViteCliAcquisitionFiles('/app');

      const path = `/app/node_modules/vite/${relativeChunk}`;
      const source = readText(fsSync, path);
      expect(viteConfigTempPatchApplied(source, version)).toBe(true);
      expect(source).toContain('__riftyViteConfigTempFs.mkdir');
      expect(source).toContain('__riftyViteConfigTempFs.writeFile');
      expect(source).toContain('__riftyViteConfigTempFs.unlink');
      expect(source).toContain('import(pathToFileURL(tempFileName).href)');
      expect(readPreparedViteConfigSource(fsSync, '/app', version)?.relativeSourcePath).toBe(
        `node_modules/vite/${relativeChunk}`,
      );
    },
  );

  it('loud-rejects an unsupported Vite artifact before promotion', async () => {
    bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: viteManifest('8.0.15'),
    });

    await expect(prepareViteCliAcquisitionFiles('/app')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'playground.vite-config-temp-cache',
    });
  });

  it('applies only the keepalive patch in preview mode', async () => {
    const oldPreviewNeedle = [
      'configFile: options.config,',
      '\t\t\tconfigLoader: options.configLoader,',
      '\t\t\tlogLevel: options.logLevel,',
      '\t\t\tmode: options.mode,',
      '\t\t\tbuild: { outDir: options.outDir },',
      '\t\t\tpreview: {',
      '\t\t\t\tport: options.port,',
      '\t\t\t\tstrictPort: options.strictPort,',
      '\t\t\t\thost: options.host,',
      '\t\t\t\topen: options.open',
      '\t\t\t}',
    ].join('\n');
    const fsSync = bootFs({ [CLI_PATH]: `${CAC_CALL_SITE}\n${oldPreviewNeedle}` });
    await prepareViteCliAcquisitionFiles('/app');
    const patched = readText(fsSync, CLI_PATH);
    expect(patched).toContain('__riftyTrackCliPromise');
    expect(patched).toContain(oldPreviewNeedle);
    expect(patched).not.toContain('cors: false');
  });

  it('does not pre-scan or reject project-root config', async () => {
    bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      '/app/vite.config.ts': 'export default { preview: { cors: true } };\n',
    });
    await expect(prepareViteCliAcquisitionFiles('/app')).resolves.toBeUndefined();
  });

  it('never writes the retired hidden wrapper in any mode', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    const before = walkTree(fsSync, '/').sort();
    await prepareViteCliAcquisitionFiles('/app');
    expect(walkTree(fsSync, '/').sort()).toEqual(before);
    expect(fsSync.existsSync('/app/.rifty/vite-cli.config.mjs')).toBe(false);
  });
});

describe('viteCliMode — CAC command matching (every case probed on REAL vite 7.3.6 CLI, 2026-07-07)', () => {
  const assertMode = (args: readonly string[], expected: string): void => {
    const label = JSON.stringify(args);
    expect(viteCliMode(args), `${label} classifier`).toBe(expected);
  };

  // Real cac semantics: a command matches when the FIRST positional under THAT
  // command's grammar (global + its own booleans) equals its name; any flag the
  // candidate grammar doesn't declare boolean consumes the next non-dash token
  // (mri default). Probe harness: `vite <form>` in an empty project, dev=:5173
  // vs preview=:4173 vs build/optimize exit.
  it('global value options before the subcommand do not swallow it', () => {
    expect(viteCliMode(['--config', 'vite.custom.mjs', 'preview'])).toBe('preview');
    expect(viteCliMode(['-c', 'vite.custom.mjs', 'preview'])).toBe('preview');
    expect(viteCliMode(['--config=vite.custom.mjs', 'preview'])).toBe('preview');
    expect(viteCliMode(['--mode', 'production', 'preview'])).toBe('preview');
    expect(viteCliMode(['-m', 'production', 'preview'])).toBe('preview');
    expect(viteCliMode(['--host', '127.0.0.1', 'preview'])).toBe('preview');
    expect(viteCliMode(['--base', '/x/', 'preview'])).toBe('preview');
    expect(viteCliMode(['-l', 'info', 'preview'])).toBe('preview');
    expect(viteCliMode(['-f', 'foo', 'preview'])).toBe('preview');
    expect(viteCliMode(['--mode', 'production', 'build'])).toBe('build');
  });

  it('boolean flags of the matched command pass the subcommand through', () => {
    expect(viteCliMode(['--clearScreen', 'preview'])).toBe('preview');
    expect(viteCliMode(['--no-clearScreen', 'preview'])).toBe('preview');
    expect(viteCliMode(['--strictPort', 'preview'])).toBe('preview');
    expect(viteCliMode(['--emptyOutDir', 'build'])).toBe('build');
    expect(viteCliMode(['-w', 'build'])).toBe('build');
  });

  it('flags UNKNOWN to the candidate command eat the would-be subcommand — real vite runs dev', () => {
    // --cors/--open/--debug/--force are not declared on the preview command
    // (and --profile is a raw-argv hack, invisible to cac) → each consumed
    // 'preview' in the probe and vite served :5173.
    expect(viteCliMode(['--cors', 'preview'])).toBe('dev');
    expect(viteCliMode(['--open', 'preview'])).toBe('dev');
    expect(viteCliMode(['--debug', 'preview'])).toBe('dev');
    expect(viteCliMode(['-d', 'preview'])).toBe('dev');
    expect(viteCliMode(['--profile', 'preview'])).toBe('dev');
    expect(viteCliMode(['--host', 'preview'])).toBe('dev');
    expect(viteCliMode(['--force', 'preview'])).toBe('dev');
  });

  it('tokens after -- never match a command (cac strips them before matching)', () => {
    expect(viteCliMode(['--', 'preview'])).toBe('dev');
    expect(viteCliMode(['build', '--', 'x'])).toBe('build');
  });

  it('plain forms: bare dev, root arg, aliases, subcommand-first', () => {
    expect(viteCliMode([])).toBe('dev');
    expect(viteCliMode(['--port', '5174'])).toBe('dev');
    expect(viteCliMode(['my-app'])).toBe('dev');
    expect(viteCliMode(['serve'])).toBe('dev');
    expect(viteCliMode(['dev'])).toBe('dev');
    expect(viteCliMode(['preview'])).toBe('preview');
    expect(viteCliMode(['preview', '--port', '4173'])).toBe('preview');
    expect(viteCliMode(['build'])).toBe('build');
  });

  it('keeps existing action and positional routing active in classifier and env', () => {
    for (const { args, expected } of [
      { args: ['dev'], expected: 'dev' },
      { args: ['serve'], expected: 'dev' },
      { args: ['build'], expected: 'build' },
      { args: ['preview'], expected: 'preview' },
      { args: ['info'], expected: 'dev' },
      { args: ['-l', 'info', 'preview'], expected: 'preview' },
    ]) {
      assertMode(args, expected);
    }
  });

  const actions = [
    { command: 'dev', mode: 'dev' },
    { command: 'serve', mode: 'dev' },
    { command: 'build', mode: 'build' },
    { command: 'preview', mode: 'preview' },
    { command: 'optimize', mode: 'optimize' },
  ] as const;
  const contractRedCases: Array<{
    readonly args: readonly string[];
    readonly expected: string;
  }> = [
    { args: ['optimize'], expected: 'optimize' },
    { args: ['--force', 'optimize'], expected: 'optimize' },
    { args: ['--help'], expected: 'info' },
    { args: ['-h'], expected: 'info' },
    { args: ['--version'], expected: 'info' },
    { args: ['-v'], expected: 'info' },
    { args: ['my-app', '--version'], expected: 'info' },
    { args: ['--port', '5174', '--version'], expected: 'info' },
  ];
  for (const { command, mode } of actions) {
    for (const flag of ['--help', '-h']) {
      contractRedCases.push(
        { args: [command, flag], expected: 'info' },
        { args: [flag, command], expected: 'info' },
      );
    }
    // CAC suppresses version only when no NAMED command matched.
    for (const flag of ['--version', '-v']) {
      contractRedCases.push(
        { args: [command, flag], expected: mode },
        { args: [flag, command], expected: mode },
      );
    }
  }
  for (const { args, expected } of contractRedCases) {
    it(`routes ${JSON.stringify(args)} as ${expected}`, () => {
      assertMode(args, expected);
    });
  }
});

describe('prepareViteBinSpawnRequest — host-only preview correlation', () => {
  const request = {
    shimPath: '/proj/node_modules/.bin/vite',
    args: ['--config', 'vite.custom.mjs', 'preview'],
    cwd: '/proj',
    env: { USER_VALUE: 'kept', NAPI_RS_FORCE_WASI: '0' },
    isTTY: false,
  };

  it('mints preview scope and selects the installed upstream WASI binding', () => {
    const prepared = prepareViteBinSpawnRequest(request);
    expect(prepared.previewScope).toBeDefined();
    expect(prepared.env).toEqual({
      USER_VALUE: 'kept',
      NAPI_RS_FORCE_WASI: '1',
    });
    expect(request.env).toEqual({
      USER_VALUE: 'kept',
      NAPI_RS_FORCE_WASI: '0',
    });
  });

  it('leaves non-vite requests unchanged', () => {
    const webpack = { ...request, shimPath: '/proj/node_modules/.bin/webpack' };
    expect(prepareViteBinSpawnRequest(webpack)).toBe(webpack);
  });
});

describe('Vite esbuild runtime startup policy', () => {
  it('starts only exact Vite 7.3.6 and resolves a hoisted package from the executed shim', async () => {
    const hoistedCli = '/workspace/node_modules/vite/dist/node/cli.js';
    const fsSync = bootFs({
      '/workspace/packages/app/package.json': '{}',
      '/workspace/node_modules/vite/package.json': viteManifest('7.3.6'),
      [hoistedCli]: CAC_CALL_SITE,
    });
    const bin = '/workspace/node_modules/.bin/vite';
    expect(
      decideViteEsbuildRuntime({ fs: fsSync, packageRoot: '/workspace/node_modules/vite' }),
    ).toBe('start');
    await prepareViteCliAcquisitionFiles('/workspace/packages/app', bin);
    expect(readText(fsSync, hoistedCli)).toContain('__riftyTrackCliPromise');
  });

  it('skips Vite 8 Rolldown without fetching, compiling, starting, or publishing', async () => {
    const fsSync = bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: viteManifest('8.0.16'),
    });
    const savedFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('Vite 8 must not fetch esbuild wasm'));
    };
    clearEsbuildRuntimeSlot();
    try {
      expect(decideViteEsbuildRuntime({ fs: fsSync, packageRoot: '/app/node_modules/vite' })).toBe(
        'skip-rolldown',
      );
      await prepareViteCliAcquisitionFiles('/app');
      await prepareVite('build');
      expect(fetchCalls).toBe(0);
      expect(g.__rifty === undefined || !Reflect.has(g.__rifty, 'esbuild')).toBe(true);
    } finally {
      globalThis.fetch = savedFetch;
      clearEsbuildRuntimeSlot();
    }
  });

  it('Vite 7 info mode requires the same verified runtime capability before import', async () => {
    bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: viteManifest('7.3.6'),
    });
    await prepareViteCliAcquisitionFiles('/app');

    expect(
      planViteCliPreparation({ root: '/app', mode: 'info', executedBinPath: VITE_BIN })
        .runtimeDecision,
    ).toBe('start');
    await expect(prepareVite('info')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'vite.esbuild.shadowAssets',
    });
  });

  it('Vite 8 info mode validates prepared files without consulting esbuild assets', async () => {
    const fsSync = bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: viteManifest('8.0.16'),
    });
    const savedFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('info must not fetch esbuild wasm'));
    };
    clearEsbuildRuntimeSlot();
    try {
      await prepareViteCliAcquisitionFiles('/app');
      await prepareVite('info');
      expect(readText(fsSync, CLI_PATH)).toContain('__riftyTrackCliPromise');
      expect(fetchCalls).toBe(0);
      expect(g.__rifty === undefined || !Reflect.has(g.__rifty, 'esbuild')).toBe(true);
    } finally {
      globalThis.fetch = savedFetch;
      clearEsbuildRuntimeSlot();
    }
  });

  it('loud-fails unpinned esbuild-consuming Vite before fetching wasm', async () => {
    bootFs({ [CLI_PATH]: CAC_CALL_SITE, [VITE_PACKAGE_JSON]: viteManifest('7.3.5') });
    const savedFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('version gate must run first'));
    };
    try {
      await expect(prepareViteCliAcquisitionFiles('/app')).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'playground.vite-config-temp-cache',
      });
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('loud-fails a forged Vite mode whose argv[1] is not a canonical installed entry', async () => {
    bootFs();
    await expect(prepareVite('dev', '/app/scripts/vite.js')).rejects.toThrow(
      'expected an installed Vite entry',
    );
  });
});

// Keep this fault last: ADR-0226 gives a failed startup no retry lifecycle;
// the real child Worker terminates, while this unit realm stays alive.
// Browser contract proves dev/build/preview/optimize routing; this faults their shared branch.
describe('prepareViteCli — mode-independent esbuild startup fault (ADR-0226)', () => {
  it('startup failure rejects the child and leaves the typed runtime slot absent', async () => {
    bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: JSON.stringify({ name: 'vite', version: '7.3.6' }),
    });
    const failure = new Error('contract injected esbuild startup failure');
    const readVerified = vi.fn(() => Promise.reject(failure));
    const shadowAssets = { readVerified };
    clearEsbuildRuntimeSlot();

    try {
      await prepareViteCliAcquisitionFiles('/app');
      await expect(prepareVite('build', VITE_BIN, shadowAssets)).rejects.toBe(failure);
      expect(readVerified).toHaveBeenCalledTimes(1);
      expect(g.__rifty === undefined || !Reflect.has(g.__rifty, 'esbuild')).toBe(true);
      await expect(prepareVite('build', VITE_BIN, shadowAssets)).rejects.toBe(failure);
      expect(readVerified).toHaveBeenCalledTimes(1);
    } finally {
      clearEsbuildRuntimeSlot();
    }
  });
});
