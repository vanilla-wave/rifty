import {
  type MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareViteCli, viteCliMode } from './vite-cli-prep.ts';

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

interface TestGlobals {
  __riftyTestCac?: new (action: () => unknown) => { parse(): void };
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
  g.__riftyEsbuild = undefined;
  resetSyncMirror();
});

describe('prepareViteCli — CLI keepalive patch (CAC never awaits async actions)', () => {
  it('module parses and loads (a stray backtick in a template-literal comment breaks the worker fetch)', async () => {
    await expect(import('./vite-cli-prep.ts')).resolves.toBeDefined();
  });

  it('patched CLI hands a detached async action promise to the keepalive tracker', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app');
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
    await prepareViteCli('/app');
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
    await prepareViteCli('/app');
    const once = readText(fsSync, CLI_PATH);
    await prepareViteCli('/app');
    expect(readText(fsSync, CLI_PATH)).toBe(once);
    expect(() => runPatchedCli(fsSync)).not.toThrow();
  });

  it('loud-throws when the vite CLI drops the runMatchedCommand call shape', async () => {
    bootFs({ [CLI_PATH]: 'export function parse() {}' });
    await expect(prepareViteCli('/app')).rejects.toThrow(
      'vite CLI keepalive patch failed: runMatchedCommand call shape not found',
    );
  });

  it('tolerates a project without a vite CLI file — no patch write, tracker still wired', async () => {
    const fsSync = bootFs();
    await prepareViteCli('/app');
    expect(fsSync.existsSync(CLI_PATH)).toBe(false);
    expect(typeof g.__riftyTrackCliPromise).toBe('function');
  });
});

describe('prepareViteCli — preview runs the real vite CLI unchanged', () => {
  // Reframed contract (was: throw on any project-root vite.config): rifty no
  // longer pre-scans config or force-disables preview cors. The real CLI loads
  // the user's config; a preview option the same-origin bridge cannot honor
  // surfaces at its OWN execution boundary (net throws on an unsupported proxy
  // target), not a pre-flight guard here.
  it('applies only the keepalive pin — no forced preview cors/config patch', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app');
    const patched = readText(fsSync, CLI_PATH);
    expect(patched).toContain('__riftyTrackCliPromise'); // keepalive still lands
    expect(patched).not.toContain('cors: false'); // no forced cors override
    expect(patched).not.toContain('vite-preview-cors-middleware-parity');
  });

  it('a project-root vite.config no longer trips a rifty preview guard (real vite loads it)', async () => {
    bootFs({
      [CLI_PATH]: CAC_CALL_SITE,
      '/app/vite.config.ts': 'export default { preview: { cors: true } };\n',
    });
    // Was NotImplementedError('vite.preview.config-loading'); prep is now a no-op
    // wrt config — the real CLI owns config loading.
    await expect(prepareViteCli('/app')).resolves.toBeUndefined();
  });
});

describe('prepareViteCli — wrapper deletion guard', () => {
  it('never writes a rifty Vite config wrapper', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app');
    expect(fsSync.existsSync(WRAPPER_PATH)).toBe(false);
  });

  it('installs the lazy esbuild host bridge (ADR-0192)', async () => {
    bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli('/app');
    expect(g.__riftyEsbuild).toBeDefined();
  });

  it('writes ONLY the CLI patch — zero shim glue or wrapper files at prep time (ADR-0188)', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    const before = walkTree(fsSync, '/').sort();
    await prepareViteCli('/app');
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
