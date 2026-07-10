import {
  type MemoryFsSync,
  createMemoryFs,
  resetSyncMirror,
  setSyncMirror,
} from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareViteCli } from './vite-cli-prep.ts';

// Behavioral heirs of the retired vite-cli-prep source greps (epic
// playground-testable-core): every test drives the REAL prepareViteCli against
// a memory VFS holding a fixture vite CLI, then EXECUTES the patched output
// (template-literal trap: generated code must run, not just match).

const dec = new TextDecoder();
// prepareViteCli's contract (renegotiated, PR#125 false-fallback): the argument
// is the EXECUTED `.bin/vite` shim path (argv[1]), no longer a project root —
// the patch target derives from the shim's node_modules, not from cwd.
const BIN_PATH = '/app/node_modules/.bin/vite';
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
    await prepareViteCli(BIN_PATH);
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
    await prepareViteCli(BIN_PATH);
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
    await prepareViteCli(BIN_PATH);
    const once = readText(fsSync, CLI_PATH);
    await prepareViteCli(BIN_PATH);
    expect(readText(fsSync, CLI_PATH)).toBe(once);
    expect(() => runPatchedCli(fsSync)).not.toThrow();
  });

  it('loud-throws when the vite CLI drops the runMatchedCommand call shape', async () => {
    bootFs({ [CLI_PATH]: 'export function parse() {}' });
    await expect(prepareViteCli(BIN_PATH)).rejects.toThrow(
      'vite CLI keepalive patch failed: runMatchedCommand call shape not found',
    );
  });

  it('tolerates a project without a vite CLI file — no patch write, tracker still wired', async () => {
    const fsSync = bootFs();
    await prepareViteCli(BIN_PATH);
    expect(fsSync.existsSync(CLI_PATH)).toBe(false);
    expect(typeof g.__riftyTrackCliPromise).toBe('function');
  });

  // PR#125 finding (false-fallback): resolveBin walks ANCESTOR node_modules
  // (hoisting), but a cwd-anchored patch lookup silently skipped the hoisted
  // vite → CAC exited early → dev server died with no signal. The patch target
  // must derive from the EXECUTED shim path (argv[1]).
  it('hoisted layout: patches the vite the executed shim belongs to, not a cwd-anchored lookup', async () => {
    const hoistedCli = '/repo/node_modules/vite/dist/node/cli.js';
    const fsSync = bootFs({
      '/repo/node_modules/.bin/vite': '#!/usr/bin/env node',
      [hoistedCli]: CAC_CALL_SITE,
      '/repo/app/package.json': '{}', // process cwd lives HERE — no vite below it
    });
    await prepareViteCli('/repo/node_modules/.bin/vite');
    expect(readText(fsSync, hoistedCli)).toContain('__riftyTrackCliPromise');

    new Function(readText(fsSync, hoistedCli))();
    const tracked: unknown[] = [];
    g.__riftyTrackCliPromise = (promise) => {
      tracked.push(promise);
    };
    const action = Promise.resolve('served');
    new (testCac())(() => action).parse();
    expect(tracked).toEqual([action]);
  });

  it('foreign bin named vite (no cli.js at the derived package path) skips without throwing', async () => {
    const foreignShim = '/tools/node_modules/.bin/vite';
    const fsSync = bootFs({ [foreignShim]: 'console.log("not the real vite")' });
    await expect(prepareViteCli(foreignShim)).resolves.toBeUndefined();
    expect(fsSync.existsSync('/tools/node_modules/vite/dist/node/cli.js')).toBe(false);
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
    await prepareViteCli(BIN_PATH);
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
    await expect(prepareViteCli(BIN_PATH)).resolves.toBeUndefined();
  });
});

describe('prepareViteCli — wrapper deletion guard', () => {
  it('never writes a rifty Vite config wrapper', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli(BIN_PATH);
    expect(fsSync.existsSync(WRAPPER_PATH)).toBe(false);
  });

  it('installs the lazy esbuild host bridge (ADR-0192)', async () => {
    bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    await prepareViteCli(BIN_PATH);
    expect(g.__riftyEsbuild).toBeDefined();
  });

  it('writes ONLY the CLI patch — zero shim glue or wrapper files at prep time (ADR-0188)', async () => {
    const fsSync = bootFs({ [CLI_PATH]: CAC_CALL_SITE });
    const before = walkTree(fsSync, '/').sort();
    await prepareViteCli(BIN_PATH);
    const after = walkTree(fsSync, '/').sort();
    expect(after).toEqual(before);
  });
});
