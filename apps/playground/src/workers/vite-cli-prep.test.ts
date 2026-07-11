import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareViteCli, viteCliMode, withViteCliArgs, withViteCliEnv } from './vite-cli-prep.ts';

// Behavioral heirs of the retired vite-cli-prep source greps (epic
// playground-testable-core): every test drives the REAL prepareViteCli against
// a memory VFS holding a fixture vite CLI, then EXECUTES the patched output /
// generated wrapper (template-literal trap: generated code must run, not just
// match).

const dec = new TextDecoder();
const CLI_PATH = '/app/node_modules/vite/dist/node/cli.js';
const WRAPPER_PATH = '/app/.rifty/vite-cli.config.mjs';
// Keeps baseline keepalive tests green before and after the Contract+RED mode
// classifier is implemented: this is CAC's no-action path in both versions.
const INFORMATIONAL_MODE = viteCliMode(['--version']);

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
  __rifty?: { esbuild?: unknown };
  __riftyTestCac?: new (action: () => unknown) => { parse(): void };
  __riftyTestPreviewConfig?: (options: typeof PREVIEW_OPTIONS) => Record<string, unknown>;
  __riftyActiveViteServer?: unknown;
  __riftyEsbuildTransform?: unknown;
  __riftyTrackCliPromise?: (promise: PromiseLike<unknown>) => void;
}
const g = globalThis as TestGlobals;

function clearEsbuildRuntimeSlot(): void {
  if (g.__rifty) Reflect.deleteProperty(g.__rifty, 'esbuild');
}

interface MergedViteConfig {
  readonly base: unknown;
  readonly appType: unknown;
  readonly optimizeDeps: Record<string, unknown>;
  readonly server: Record<string, unknown>;
  readonly plugins: readonly {
    readonly name?: string;
    readonly configureServer?: (server: unknown) => void;
  }[];
  readonly [key: string]: unknown;
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

/** Import the GENERATED wrapper module (no user-config import) via a data URL —
 * real ESM execution of the emitted source. */
async function importWrapperDefault(
  fsSync: MemoryFsSync,
): Promise<(env: { command: string; mode: string }) => Promise<MergedViteConfig>> {
  const source = readText(fsSync, WRAPPER_PATH);
  const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  const mod = (await import(/* @vite-ignore */ url)) as {
    default: (env: { command: string; mode: string }) => Promise<MergedViteConfig>;
  };
  return mod.default;
}

/** Import the generated wrapper NEXT TO a real user config file — the wrapper's
 * relative import specifier must resolve on a real filesystem. */
async function importWrapperWithUserConfig(
  fsSync: MemoryFsSync,
  userConfig: { readonly relativePath: string; readonly source: string },
): Promise<(env: { command: string; mode: string }) => Promise<MergedViteConfig>> {
  const tmp = mkdtempSync(join(tmpdir(), 'rifty-vite-cli-wrapper-'));
  try {
    const userDiskPath = join(tmp, userConfig.relativePath);
    mkdirSync(join(userDiskPath, '..'), { recursive: true });
    writeFileSync(userDiskPath, userConfig.source);
    mkdirSync(join(tmp, '.rifty'), { recursive: true });
    const wrapperDiskPath = join(tmp, '.rifty/vite-cli.config.mjs');
    writeFileSync(wrapperDiskPath, readText(fsSync, WRAPPER_PATH));
    const mod = (await import(/* @vite-ignore */ pathToFileURL(wrapperDiskPath).href)) as {
      default: (env: { command: string; mode: string }) => Promise<MergedViteConfig>;
    };
    return mod.default;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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
  g.__riftyActiveViteServer = undefined;
  g.__riftyEsbuildTransform = undefined;
  resetSyncMirror();
});

describe('prepareViteCli — CLI keepalive patch (CAC never awaits async actions)', () => {
  it('module parses and loads (a stray backtick in a template-literal comment breaks the worker fetch)', async () => {
    await expect(import('./vite-cli-prep.ts')).resolves.toBeDefined();
  });

  it('patched CLI hands a detached async action promise to the keepalive tracker', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app', INFORMATIONAL_MODE);
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
    await prepareViteCli('/app', INFORMATIONAL_MODE);
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
    await prepareViteCli('/app', INFORMATIONAL_MODE);
    const once = readText(fsSync, CLI_PATH);
    await prepareViteCli('/app', INFORMATIONAL_MODE);
    expect(readText(fsSync, CLI_PATH)).toBe(once);
    expect(() => runPatchedCli(fsSync)).not.toThrow();
  });

  it('loud-throws when the vite CLI drops the runMatchedCommand call shape', async () => {
    bootFs({ [CLI_PATH]: 'export function parse() {}' });
    await expect(prepareViteCli('/app', INFORMATIONAL_MODE)).rejects.toThrow(
      'vite CLI keepalive patch failed: runMatchedCommand call shape not found',
    );
  });

  it('tolerates a project without a vite CLI file — no patch write, tracker still wired', async () => {
    const fsSync = bootFs();
    await prepareViteCli('/app', INFORMATIONAL_MODE);
    expect(fsSync.existsSync(CLI_PATH)).toBe(false);
    expect(typeof g.__riftyTrackCliPromise).toBe('function');
  });
});

describe('prepareViteCli — vite preview inline config patch (no config-file loading)', () => {
  it('forces configFile:false + allowedHosts + cors:false and preserves the user preview flags EXACTLY', async () => {
    const fsSync = bootFs({ [CLI_PATH]: `${CAC_CALL_SITE}\n${PREVIEW_CALL_SITE}` });
    await prepareViteCli('/app', 'preview');
    runPatchedCli(fsSync);

    // toEqual is exact: proves the patch adds NOTHING beyond allowedHosts+cors
    // (no `...user.preview` spread) and never loads options.config.
    expect(previewConfig()(PREVIEW_OPTIONS)).toEqual({
      configFile: false,
      configLoader: 'bundle',
      logLevel: 'info',
      mode: 'production',
      build: { outDir: 'out' },
      preview: {
        port: 4173,
        strictPort: false,
        host: '127.0.0.1',
        open: true,
        allowedHosts: true,
        cors: false,
      },
    });
    // The honest-gap pointer travels with the patched output.
    expect(readText(fsSync, CLI_PATH)).toContain(
      'TODO(backlog: playground/vite-preview-cors-middleware-parity)',
    );
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

  it('refuses a user vite config in preview mode BEFORE patching anything (NotImplementedError)', async () => {
    const fixture = `${CAC_CALL_SITE}\n${PREVIEW_CALL_SITE}`;
    const fsSync = bootFs({ [CLI_PATH]: fixture, '/app/vite.config.ts': 'export default {};\n' });
    await expect(prepareViteCli('/app', 'preview')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'vite.preview.config-loading',
    });
    expect(readText(fsSync, CLI_PATH)).toBe(fixture);
  });

  it('refuses an explicitly passed userConfigPath in preview mode', async () => {
    bootFs({ [CLI_PATH]: `${CAC_CALL_SITE}\n${PREVIEW_CALL_SITE}` });
    await expect(
      prepareViteCli('/app', 'preview', { userConfigPath: 'conf/custom-vite.mjs' }),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'vite.preview.config-loading',
    });
  });
});

describe('prepareViteCli — dev CLI config wrapper (forced options + server handle, ADR-0189)', () => {
  it('without a user config the executed wrapper forces ONLY the two surviving options (PR #112)', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app', 'dev');
    const config = await importWrapperDefault(fsSync);
    const merged = await config({ command: 'serve', mode: 'development' });

    // Retired forces stay retired (each with its e2e proof, backlog
    // net/preview-websocket-bridge): base './' (SW port-context routing,
    // ADR-0097), appType (vite default), server.strictPort (port-derived
    // lifecycle), server.host (SW stamps Host localhost:<port>, ADR-0189 D3).
    expect(merged.base).toBeUndefined();
    expect(merged.appType).toBeUndefined();
    expect(merged.optimizeDeps).toEqual({ noDiscovery: true, include: [] });
    // Exact server object: ONLY allowedHosts forced and NO hmr key — stock HMR
    // flows through the generic preview bridge (ADR-0189 retired the endpoint
    // rewrite + client-script injection).
    expect(merged.server).toEqual({ allowedHosts: true });
  });

  it('hmrOff pins server.hmr:false (Vite 8 Rolldown socket parity, ADR-0161)', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app', 'dev', { hmrOff: true });
    const config = await importWrapperDefault(fsSync);
    const merged = await config({ command: 'serve', mode: 'development' });
    expect(merged.server.hmr).toBe(false);
  });

  it('the wrapper plugin publishes the live server handle for editor-write invalidation', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app', 'dev');
    const config = await importWrapperDefault(fsSync);
    const merged = await config({ command: 'serve', mode: 'development' });

    const handle = merged.plugins.at(-1);
    expect(handle?.name).toBe('rifty:vite-server-handle');
    const server = { moduleGraph: { invalidateModule: () => {} } };
    handle?.configureServer?.(server);
    expect(g.__riftyActiveViteServer).toBe(server);
  });

  it('merges a detected root user config: user values kept, rifty forcings still applied, user plugins first', async () => {
    const fsSync = bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      // Present in the project root → findUserViteConfig wires it into the wrapper.
      '/app/vite.config.mjs': 'unused on disk — content re-written below\n',
    });
    await prepareViteCli('/app', 'dev');
    const config = await importWrapperWithUserConfig(fsSync, {
      relativePath: 'vite.config.mjs',
      source: [
        'export default {',
        "  base: '/custom/',",
        "  appType: 'mpa',",
        "  optimizeDeps: { include: ['react'], force: true },",
        "  server: { host: false, hmr: { port: 24678 }, proxy: { '/api': 'http://upstream' } },",
        "  plugins: [{ name: 'user-plugin' }],",
        '};',
        '',
      ].join('\n'),
    });
    const merged = await config({ command: 'serve', mode: 'development' });

    expect(merged.base).toBe('/custom/');
    expect(merged.appType).toBe('mpa');
    expect(merged.optimizeDeps).toEqual({ force: true, noDiscovery: true, include: ['react'] });
    expect(merged.server).toEqual({
      host: false, // host force retired (PR #112) — user value flows through
      hmr: { port: 24678 }, // stock HMR: user's server.hmr flows through untouched
      proxy: { '/api': 'http://upstream' },
      allowedHosts: true,
    });
    expect(merged.plugins.map((plugin) => plugin.name)).toEqual([
      'user-plugin',
      'rifty:vite-server-handle',
    ]);
  });

  it('a function user config (explicit userConfigPath) is awaited with the vite env', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app', 'dev', { userConfigPath: 'conf/custom-vite.mjs' });
    const config = await importWrapperWithUserConfig(fsSync, {
      relativePath: 'conf/custom-vite.mjs',
      source: 'export default async (env) => ({ base: `/${env.command}-${env.mode}/` });\n',
    });
    const merged = await config({ command: 'serve', mode: 'development' });
    expect(merged.base).toBe('/serve-development/');
  });

  it('only dev mode writes the wrapper config', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app', INFORMATIONAL_MODE);
    expect(fsSync.existsSync(WRAPPER_PATH)).toBe(false);
    await prepareViteCli('/app', 'build');
    expect(fsSync.existsSync(WRAPPER_PATH)).toBe(false);
    await prepareViteCli('/app', 'dev');
    expect(fsSync.existsSync(WRAPPER_PATH)).toBe(true);
  });

  it('dev and build install the legacy transform bridge; the informational path does not', async () => {
    bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app', INFORMATIONAL_MODE);
    expect(g.__riftyEsbuildTransform).toBeUndefined();
    await prepareViteCli('/app', 'build');
    expect(typeof g.__riftyEsbuildTransform).toBe('function');
    g.__riftyEsbuildTransform = undefined;
    await prepareViteCli('/app', 'dev');
    expect(typeof g.__riftyEsbuildTransform).toBe('function');
  });

  it('writes ONLY the CLI patch and the wrapper — zero shim glue at prep time (ADR-0188)', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    const before = walkTree(fsSync, '/').sort();
    await prepareViteCli('/app', 'dev');
    const after = walkTree(fsSync, '/').sort();
    expect(after).toEqual([...before, '/app/.rifty', WRAPPER_PATH].sort());
  });
});

describe('viteCliMode — CAC command matching (every case probed on REAL vite 7.3.6 CLI, 2026-07-07)', () => {
  const ctx = {
    cwd: '/proj',
    env: {},
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  } as unknown as Parameters<typeof withViteCliEnv>[2];
  const assertMode = (args: readonly string[], expected: string): void => {
    const label = JSON.stringify(args);
    expect(viteCliMode(args), `${label} classifier`).toBe(expected);
    expect(
      withViteCliEnv('/proj/node_modules/.bin/vite', args, ctx).env.RIFTY_VITE_CLI_MODE,
      `${label} env`,
    ).toBe(expected);
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
    it.fails(`routes ${JSON.stringify(args)} as ${expected}`, () => {
      assertMode(args, expected);
    });
  }
});

describe('withViteCliArgs — retired preview forces stay retired (behavioral, PR #112)', () => {
  const ctx = {
    cwd: '/proj',
    env: {},
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  } as unknown as Parameters<typeof withViteCliArgs>[2];

  it('preview mode passes args through UNTOUCHED — no --host/--strictPort injection (ADR-0189 D3)', () => {
    expect(withViteCliArgs('/proj/node_modules/.bin/vite', ['preview'], ctx)).toEqual(['preview']);
    expect(
      withViteCliArgs('/proj/node_modules/.bin/vite', ['preview', '--port', '4173'], ctx),
    ).toEqual(['preview', '--port', '4173']);
  });

  it('dev mode injects ONLY the wrapper --config (user config re-routed via env, not args)', () => {
    expect(withViteCliArgs('/proj/node_modules/.bin/vite', ['--port', '5174'], ctx)).toEqual([
      '--port',
      '5174',
      '--config',
      '/proj/.rifty/vite-cli.config.mjs',
    ]);
  });

  it('dev mode injects the wrapper config before -- rest args so Vite still parses it', () => {
    expect(withViteCliArgs('/proj/node_modules/.bin/vite', ['--', 'preview'], ctx)).toEqual([
      '--config',
      '/proj/.rifty/vite-cli.config.mjs',
      '--',
      'preview',
    ]);
    expect(
      withViteCliArgs('/proj/node_modules/.bin/vite', ['dev', '--', '--host', 'x'], ctx),
    ).toEqual(['dev', '--config', '/proj/.rifty/vite-cli.config.mjs', '--', '--host', 'x']);
    expect(
      withViteCliArgs(
        '/proj/node_modules/.bin/vite',
        ['--config', 'vite.custom.mjs', '--', 'tail'],
        ctx,
      ),
    ).toEqual(['--config', '/proj/.rifty/vite-cli.config.mjs', '--', 'tail']);
  });

  it('non-vite bins pass through untouched', () => {
    expect(withViteCliArgs('/proj/node_modules/.bin/webpack', ['serve'], ctx)).toEqual(['serve']);
  });

  it('option-first preview forms pass through untouched too (review-blocker case)', () => {
    expect(
      withViteCliArgs('/proj/node_modules/.bin/vite', ['--mode', 'production', 'preview'], ctx),
    ).toEqual(['--mode', 'production', 'preview']);
    const enved = withViteCliEnv(
      '/proj/node_modules/.bin/vite',
      ['--config', 'vite.custom.mjs', 'preview'],
      ctx,
    );
    expect(enved.env.RIFTY_VITE_CLI_MODE).toBe('preview');
    expect(enved.env.RIFTY_VITE_CLI_USER_CONFIG).toBe('/proj/vite.custom.mjs');
  });

  it('--config followed by a flag has no value (mri never consumes a dash token)', () => {
    const enved = withViteCliEnv('/proj/node_modules/.bin/vite', ['--config', '--port', '1'], ctx);
    expect(enved.env.RIFTY_VITE_CLI_USER_CONFIG).toBeUndefined();
    // Dev wrapper injection must strip exactly the config FLAG, not its neighbours.
    expect(
      withViteCliArgs('/proj/node_modules/.bin/vite', ['--config', '--port', '1'], ctx),
    ).toEqual(['--port', '1', '--config', '/proj/.rifty/vite-cli.config.mjs']);
  });

  it('withViteCliEnv threads mode + hmr-off pin, nothing else for stock HMR', () => {
    const enved = withViteCliEnv('/proj/node_modules/.bin/vite', ['--port', '5174'], ctx, {
      hmrOff: true,
    });
    expect(enved.env.RIFTY_VITE_CLI_MODE).toBe('dev');
    expect(enved.env.RIFTY_VITE_CLI_HMR_OFF).toBe('1');
    const stock = withViteCliEnv('/proj/node_modules/.bin/vite', ['--port', '5174'], ctx);
    expect(stock.env.RIFTY_VITE_CLI_HMR_OFF).toBeUndefined();
    expect(stock.env.RIFTY_VITE_CLI_PORT).toBeUndefined();
  });
});

// Keep this fault last: ADR-0226 gives a failed startup no retry lifecycle;
// the real child Worker terminates, while this unit realm stays alive.
// Browser Contract+RED proves dev/build/preview/optimize routing; this faults their shared branch.
describe('prepareViteCli — mode-independent esbuild startup fault (ADR-0226)', () => {
  it.fails(
    'startup failure rejects the child and leaves the typed runtime slot absent',
    async () => {
      bootFs({ [CLI_PATH]: CAC_CALL_SITE });
      const savedFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls += 1;
        return Promise.reject(new Error('contract injected esbuild startup failure'));
      };
      clearEsbuildRuntimeSlot();

      try {
        await expect(prepareViteCli('/app', 'build')).rejects.toThrow();
        expect(fetchCalls).toBe(1);
        expect(g.__rifty === undefined || !Reflect.has(g.__rifty, 'esbuild')).toBe(true);
      } finally {
        globalThis.fetch = savedFetch;
        clearEsbuildRuntimeSlot();
      }
    },
  );
});
