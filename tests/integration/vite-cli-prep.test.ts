import {
  type MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import {
  publishRuntimeEsbuild,
  readRuntimeEsbuild,
} from '../../tools/shadow-registry/src/runtime/realm.ts';
import {
  prepareViteBinSpawnRequest,
  prepareViteCli,
  viteCliMode,
  viteCliPreparationFromArgs,
} from '../../tools/shadow-registry/src/runtime/vite-cli-prep.ts';
import { decideViteEsbuildRuntime } from '../../tools/shadow-registry/src/runtime/vite-esbuild-runtime.ts';

// Behavioral heirs of the retired vite-cli-prep source greps (epic
// playground-testable-core): file tests drive the pre-runtime preparation over
// memory VFS and execute its output. Only the final fault enters the one-shot
// runtime startup branch.

const dec = new TextDecoder();
const CLI_PATH = '/app/node_modules/vite/dist/node/cli.js';
const VITE_PACKAGE_JSON = '/app/node_modules/vite/package.json';
const VITE_BIN = '/app/node_modules/.bin/vite';

function prepareVite(mode: 'dev' | 'build' | 'preview' | 'optimize' | 'info', bin = VITE_BIN) {
  return prepareViteCli({
    root: '/app',
    mode,
    executedBinPath: bin,
  });
}
/** Real vite dist/node/cli.js CAC call shape: rifty leaves these bytes upstream. */
const CAC_CALL_SITE = [
  'class TestCac {',
  '  parse() {',
  '    this.runMatchedCommand();',
  '  }',
  '}',
].join('\n');

interface TestGlobals {
  __riftyShadowRegistry?: { esbuild?: unknown };
}
const g = globalThis as TestGlobals;

function clearEsbuildRuntimeSlot(): void {
  if (g.__riftyShadowRegistry) Reflect.deleteProperty(g.__riftyShadowRegistry, 'esbuild');
}

function bootFs(files: Record<string, string> = {}): MemoryFsSync {
  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  fsSync.loadFixture({ '/app/package.json': '{}', ...files });
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

afterEach(() => {
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

  it('decodes the exact executed Vite shim', () => {
    expect(
      viteCliPreparationFromArgs({
        root: '/app',
        args: ['preview'],
        executedBinPath: VITE_BIN,
      }),
    ).toEqual({
      root: '/app',
      mode: 'preview',
      executedBinPath: VITE_BIN,
    });
  });
});

describe('vite-cli-prep module', () => {
  it('module parses and loads (a stray backtick in a template-literal comment breaks the worker fetch)', async () => {
    await expect(
      import('../../tools/shadow-registry/src/runtime/vite-cli-prep.ts'),
    ).resolves.toBeDefined();
  });
});

describe('prepareViteCli — trusted child preparation is read-only', () => {
  it('performs zero VFS writes and leaves installed bytes upstream on a child launch', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    const writes = captureWritePaths(fsSync);

    await prepareVite('info');

    expect(writes).toEqual([]);
    expect(readText(fsSync, CLI_PATH)).toBe(CAC_CALL_SITE);
    expect(Reflect.has(globalThis, '__riftyTrackCliPromise')).toBe(false);
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

  it('leaves an ordinary direct entry named vite unchanged', () => {
    const direct = { ...request, shimPath: '/proj/scripts/vite' };
    expect(prepareViteBinSpawnRequest(direct)).toBe(direct);
  });
});

describe('Vite esbuild runtime startup policy', () => {
  const manifest = (version: string): string => JSON.stringify({ name: 'vite', version });

  it('starts only exact Vite 7.3.6 and resolves a hoisted package from the executed shim', async () => {
    const hoistedCli = '/workspace/node_modules/vite/dist/node/cli.js';
    const fsSync = bootFs({
      '/workspace/packages/app/package.json': '{}',
      '/workspace/node_modules/vite/package.json': manifest('7.3.6'),
      [hoistedCli]: CAC_CALL_SITE,
    });
    const bin = '/workspace/node_modules/.bin/vite';
    expect(
      decideViteEsbuildRuntime({ fs: fsSync, packageRoot: '/workspace/node_modules/vite' }),
    ).toBe('start');
    expect(readText(fsSync, hoistedCli)).toBe(CAC_CALL_SITE);
  });

  it('Vite 7 consumes the already-dispatched exact outer without a host asset fetch', async () => {
    bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: manifest('7.3.6'),
    });
    const outer = Object.freeze({ version: '0.28.0' });
    publishRuntimeEsbuild(outer);
    const savedFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('Vite must consume the registry-dispatched runtime'));
    };
    try {
      await prepareVite('build');
      expect(fetchCalls).toBe(0);
      expect(readRuntimeEsbuild()).toBe(outer);
    } finally {
      globalThis.fetch = savedFetch;
      clearEsbuildRuntimeSlot();
    }
  });

  it('skips Vite 8 Rolldown without fetching, compiling, starting, or publishing', async () => {
    const fsSync = bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: manifest('8.0.0-beta.3'),
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
      await prepareVite('build');
      expect(fetchCalls).toBe(0);
      expect(
        g.__riftyShadowRegistry === undefined || !Reflect.has(g.__riftyShadowRegistry, 'esbuild'),
      ).toBe(true);
    } finally {
      globalThis.fetch = savedFetch;
      clearEsbuildRuntimeSlot();
    }
  });

  it('info mode never consults or starts the esbuild runtime', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    const savedFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('info must not fetch esbuild wasm'));
    };
    clearEsbuildRuntimeSlot();
    try {
      await prepareVite('info');
      expect(readText(fsSync, CLI_PATH)).toBe(CAC_CALL_SITE);
      expect(fetchCalls).toBe(0);
      expect(
        g.__riftyShadowRegistry === undefined || !Reflect.has(g.__riftyShadowRegistry, 'esbuild'),
      ).toBe(true);
    } finally {
      globalThis.fetch = savedFetch;
      clearEsbuildRuntimeSlot();
    }
  });

  it('loud-fails unpinned esbuild-consuming Vite before fetching wasm', async () => {
    bootFs({ [CLI_PATH]: CAC_CALL_SITE, [VITE_PACKAGE_JSON]: manifest('7.3.5') });
    const savedFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('version gate must run first'));
    };
    try {
      await expect(prepareVite('dev')).rejects.toThrow('supports exact Vite 7.3.6; executed 7.3.5');
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('loud-fails a forged Vite mode whose executed argv[1] is not a .bin/vite shim', async () => {
    bootFs();
    await expect(prepareVite('dev', '/app/scripts/vite.js')).rejects.toThrow(
      'expected an executed .bin/vite',
    );
  });
});

// Keep this fault last: ADR-0226 gives a failed startup no retry lifecycle;
// the real child Worker terminates, while this unit realm stays alive.
// Browser contract proves dev/build/preview/optimize routing; this faults their shared branch.
describe('prepareViteCli — mode-independent esbuild admission fault (ADR-0308)', () => {
  it('missing generic dispatch rejects before Vite import and never fetches a host asset', async () => {
    bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      [VITE_PACKAGE_JSON]: JSON.stringify({ name: 'vite', version: '7.3.6' }),
    });
    const savedFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new Error('host asset fetch is forbidden'));
    };
    clearEsbuildRuntimeSlot();

    try {
      await expect(prepareVite('build')).rejects.toThrow('vite.esbuild.runtime');
      expect(fetchCalls).toBe(0);
      expect(
        g.__riftyShadowRegistry === undefined || !Reflect.has(g.__riftyShadowRegistry, 'esbuild'),
      ).toBe(true);
      await expect(prepareVite('build')).rejects.toThrow('vite.esbuild.runtime');
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = savedFetch;
      clearEsbuildRuntimeSlot();
    }
  });
});
