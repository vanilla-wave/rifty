import {
  type MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { type ViteCliMode, prepareViteCli, viteCliMode } from './vite-cli-prep.ts';

// Behavioral heirs of the retired vite-cli-prep source greps (epic
// playground-testable-core): every test drives the REAL prepareViteCli against
// a memory VFS holding a fixture vite CLI, then EXECUTES the patched output
// (template-literal trap: generated code must run, not just match).

const dec = new TextDecoder();
const CLI_PATH = '/app/node_modules/vite/dist/node/cli.js';
const WRAPPER_PATH = '/app/.rifty/vite-cli.config.mjs';

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

/** Mirrors the `vite preview` inline-config shape of real vite dist/node/cli.js
 * (tab-indented, the preview patch's needle) wrapped so the test can execute the
 * (patched) config synthesis. */
const PREVIEW_INLINE_CONFIG = [
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

const PREVIEW_CALL_SITE = [
  'globalThis.__riftyTestPreviewConfig = function (options) {',
  `  return {\n    ${PREVIEW_INLINE_CONFIG}\n  };`,
  '};',
].join('\n');

const PREVIEW_OPTIONS = {
  config: '/app/vite.config.ts',
  configLoader: 'bundle',
  logLevel: 'info',
  mode: 'production',
  outDir: 'out',
  port: 4173,
  strictPort: false,
  host: '127.0.0.1',
  open: true,
} as const;

interface TestGlobals {
  __riftyTestCac?: new (action: () => unknown) => { parse(): void };
  __riftyTestPreviewConfig?: (options: typeof PREVIEW_OPTIONS) => Record<string, unknown>;
  __riftyEsbuild?: unknown;
  __riftyTrackCliPromise?: (promise: PromiseLike<unknown>) => void;
}
const g = globalThis as TestGlobals;

function bootFs(files: Record<string, string> = {}): MemoryFsSync {
  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  fsSync.loadFixture({ '/app/package.json': '{}', ...files });
  return fsSync;
}

function readText(fsSync: MemoryFsSync, path: string): string {
  return dec.decode(fsSync.readFileBytesSync(path));
}

function runPatchedCli(fsSync: MemoryFsSync): void {
  new Function(readText(fsSync, CLI_PATH))();
}

function testCac(): new (action: () => unknown) => { parse(): void } {
  const ctor = g.__riftyTestCac;
  if (!ctor) throw new Error('fixture cli.js did not register TestCac');
  return ctor;
}

function previewConfig(): (options: typeof PREVIEW_OPTIONS) => Record<string, unknown> {
  const synthesize = g.__riftyTestPreviewConfig;
  if (!synthesize) throw new Error('fixture cli.js did not register the preview config synth');
  return synthesize;
}

function prepareWithArgs(
  root: string,
  mode: ViteCliMode,
  args: readonly string[],
): Promise<void> {
  return (
    prepareViteCli as (root: string, mode: ViteCliMode, args: readonly string[]) => Promise<void>
  )(root, mode, args);
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
  g.__riftyTestPreviewConfig = undefined;
  g.__riftyEsbuild = undefined;
  resetSyncMirror();
});

describe('prepareViteCli — CLI keepalive patch (CAC never awaits async actions)', () => {
  it('module parses and loads (a stray backtick in a template-literal comment breaks the worker fetch)', async () => {
    await expect(import('./vite-cli-prep.ts')).resolves.toBeDefined();
  });

  it('patched CLI hands a detached async action promise to the keepalive tracker', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app', 'run');
    // prepareViteCli itself wires the tracker global to the runtime keepalive.
    expect(typeof g.__riftyTrackCliPromise).toBe('function');

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
    await prepareViteCli('/app', 'run');
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
    await prepareViteCli('/app', 'run');
    const once = readText(fsSync, CLI_PATH);
    await prepareViteCli('/app', 'run');
    expect(readText(fsSync, CLI_PATH)).toBe(once);
    expect(() => runPatchedCli(fsSync)).not.toThrow();
  });

  it('loud-throws when the vite CLI drops the runMatchedCommand call shape', async () => {
    bootFs({ [CLI_PATH]: 'export function parse() {}' });
    await expect(prepareViteCli('/app', 'run')).rejects.toThrow(
      'vite CLI keepalive patch failed: runMatchedCommand call shape not found',
    );
  });

  it('tolerates a project without a vite CLI file — no patch write, tracker still wired', async () => {
    const fsSync = bootFs();
    await prepareViteCli('/app', 'run');
    expect(fsSync.existsSync(CLI_PATH)).toBe(false);
    expect(typeof g.__riftyTrackCliPromise).toBe('function');
  });
});

describe('prepareViteCli — vite preview inline config patch', () => {
  it('config-free preview preserves configFile unset and adds cors:false only', async () => {
    const fsSync = bootFs({ [CLI_PATH]: `${CAC_CALL_SITE}\n${PREVIEW_CALL_SITE}` });
    await prepareViteCli('/app', 'preview');
    runPatchedCli(fsSync);

    // toEqual is exact: proves the patch adds NOTHING beyond cors (no
    // `...user.preview` spread, no allowedHosts — the "hang, not 403" was
    // rifty's missing net.isIP, fixed with parity cases/net/is-ip).
    expect(previewConfig()({ ...PREVIEW_OPTIONS, config: undefined })).toEqual({
      configFile: undefined,
      configLoader: 'bundle',
      logLevel: 'info',
      mode: 'production',
      build: { outDir: 'out' },
      preview: {
        port: 4173,
        strictPort: false,
        host: '127.0.0.1',
        open: true,
        cors: false,
      },
    });
    // The honest-gap pointer travels with the patched output.
    expect(readText(fsSync, CLI_PATH)).toContain(
      'TODO(backlog: playground/vite-preview-cors-middleware-parity)',
    );
  });

  it('preview mode loud-rejects project-root vite.config until preview CORS/config parity lands', async () => {
    bootFs({
      [CLI_PATH]: `${CAC_CALL_SITE}\n${PREVIEW_CALL_SITE}`,
      '/app/vite.config.ts': 'export default { preview: { cors: true } };\n',
    });

    await expect(prepareViteCli('/app', 'preview')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'vite.preview.config-loading',
    });
  });

  it('preview mode loud-rejects explicit --config until preview CORS/config parity lands', async () => {
    bootFs({ [CLI_PATH]: `${CAC_CALL_SITE}\n${PREVIEW_CALL_SITE}` });

    await expect(prepareWithArgs('/app', 'preview', ['--config', 'preview.config.ts'])).rejects
      .toMatchObject({
        name: 'NotImplementedError',
        feature: 'vite.preview.config-loading',
      });
  });

  it('dev mode leaves the preview inline config untouched — the patch executes only under vite preview', async () => {
    const fsSync = bootFs({ [CLI_PATH]: `${CAC_CALL_SITE}\n${PREVIEW_CALL_SITE}` });
    await prepareViteCli('/app', 'dev');
    runPatchedCli(fsSync);

    expect(previewConfig()(PREVIEW_OPTIONS)).toEqual({
      configFile: '/app/vite.config.ts',
      configLoader: 'bundle',
      logLevel: 'info',
      mode: 'production',
      build: { outDir: 'out' },
      preview: { port: 4173, strictPort: false, host: '127.0.0.1', open: true },
    });
  });

  it('loud-throws in preview mode when the vite CLI drops the preview inline-config shape', async () => {
    bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await expect(prepareViteCli('/app', 'preview')).rejects.toThrow(
      'vite CLI preview patch failed: preview inline config shape not found',
    );
  });
});

describe('prepareViteCli — wrapper deletion guard', () => {
  it('dev/build/preview never write a rifty Vite config wrapper', async () => {
    const fsSync = bootFs({ [CLI_PATH]: `${CAC_CALL_SITE}\n${PREVIEW_CALL_SITE}` });
    await prepareViteCli('/app', 'run');
    expect(fsSync.existsSync(WRAPPER_PATH)).toBe(false);
    await prepareViteCli('/app', 'build');
    expect(fsSync.existsSync(WRAPPER_PATH)).toBe(false);
    await prepareViteCli('/app', 'dev');
    expect(fsSync.existsSync(WRAPPER_PATH)).toBe(false);
    await prepareViteCli('/app', 'preview');
    expect(fsSync.existsSync(WRAPPER_PATH)).toBe(false);
  });

  it('all vite CLI modes install the lazy esbuild host bridge (ADR-0192)', async () => {
    bootFs({ [CLI_PATH]: `${CAC_CALL_SITE}\n${PREVIEW_CALL_SITE}` });
    await prepareViteCli('/app', 'run');
    expect(g.__riftyEsbuild).toBeDefined();
    g.__riftyEsbuild = undefined;
    await prepareViteCli('/app', 'build');
    expect(g.__riftyEsbuild).toBeDefined();
    g.__riftyEsbuild = undefined;
    await prepareViteCli('/app', 'dev');
    expect(g.__riftyEsbuild).toBeDefined();
    g.__riftyEsbuild = undefined;
    await prepareViteCli('/app', 'preview');
    expect(g.__riftyEsbuild).toBeDefined();
  });

  it('writes ONLY the CLI patch — zero shim glue or wrapper files at prep time (ADR-0188)', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    const before = walkTree(fsSync, '/').sort();
    await prepareViteCli('/app', 'dev');
    const after = walkTree(fsSync, '/').sort();
    expect(after).toEqual(before);
  });
});

describe('viteCliMode — CAC command matching (every case probed on REAL vite 7.3.6 CLI, 2026-07-07)', () => {
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
    expect(viteCliMode(['--force', 'optimize'])).toBe('run');
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
    expect(viteCliMode(['optimize'])).toBe('run');
  });

  it('help/version anywhere short-circuits to run (vite prints and exits)', () => {
    expect(viteCliMode(['--help'])).toBe('run');
    expect(viteCliMode(['-h'])).toBe('run');
    expect(viteCliMode(['--version'])).toBe('run');
    expect(viteCliMode(['-v'])).toBe('run');
    expect(viteCliMode(['build', '--help'])).toBe('run');
  });
});
