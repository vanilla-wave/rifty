/**
 * Mechanism tests for `runNodeEntry` (ADR-0137 fix) — the shared "run a VFS
 * Node entry through the module loader" primitive that both the shell
 * `.bin` executor and `child_process` spawn route through.
 *
 * REAL Memory VFS + REAL `createModuleLoader` — no mock of the unit under test.
 * This pins the MECHANISM (shebang-stripped, relative-import-resolving entry
 * execution) without a Worker realm; the Worker transport is COI/e2e-only.
 */

import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createRequire } from './module.ts';
import { parseBinLauncherTarget, runNodeEntry } from './node-entry.ts';

const g = globalThis as Record<string, unknown>;

describe('parseBinLauncherTarget', () => {
  it('extracts the dynamic-import target from a linker launcher shim', () => {
    const shim = "#!/usr/bin/env node\nimport('../widget/cli.js');\n";
    expect(parseBinLauncherTarget(shim)).toBe('../widget/cli.js');
  });

  it('returns null when the source is not a recognizable launcher', () => {
    expect(parseBinLauncherTarget('console.log(1);\n')).toBeNull();
  });
});

describe('runNodeEntry', () => {
  it('runs a .bin launcher by importing its CJS target through the loader (shebang + relative)', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/node_modules/.bin/cli': "#!/usr/bin/env node\nimport('../widget/cli.js');\n",
      '/proj/node_modules/widget/package.json': JSON.stringify({ name: 'widget' }),
      '/proj/node_modules/widget/cli.js':
        'globalThis.__cli = (globalThis.__cli ?? 0) + 1; module.exports = {};\n',
    });
    g.__cli = 0;

    await runNodeEntry({ vfs, entryPath: '/proj/node_modules/.bin/cli', cwd: '/proj', bin: true });
    await new Promise((r) => setTimeout(r, 0)); // settle the shim's dynamic import

    expect(g.__cli).toBe(1);
  });

  it('runs a .bin launcher whose target is ESM', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/node_modules/.bin/cli': "#!/usr/bin/env node\nimport('../widget/bin.mjs');\n",
      '/proj/node_modules/widget/package.json': JSON.stringify({ name: 'widget' }),
      '/proj/node_modules/widget/bin.mjs': 'globalThis.__cliEsm = 1;\nexport {};\n',
    });
    g.__cliEsm = 0;

    await runNodeEntry({ vfs, entryPath: '/proj/node_modules/.bin/cli', cwd: '/proj', bin: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(g.__cliEsm).toBe(1);
  });

  it('runs a plain Node script entry (child_process node <script>) including a shebang', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/script.js': '#!/usr/bin/env node\nglobalThis.__script = 1;\n',
    });
    g.__script = 0;

    await runNodeEntry({ vfs, entryPath: '/work/script.js', cwd: '/work' });

    expect(g.__script).toBe(1);
  });

  it('throws a loud, named error when a .bin shim is not a recognizable launcher (never a silent no-op)', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/proj/node_modules/.bin/weird': 'not a launcher\n' });

    await expect(
      runNodeEntry({ vfs, entryPath: '/proj/node_modules/.bin/weird', cwd: '/proj', bin: true }),
    ).rejects.toThrow(/launcher/);
  });

  it('reshapes a missing ENTRY into a Node-faithful MODULE_NOT_FOUND (requireStack [], printed form)', async () => {
    // backlog/runtime-js/node-entry-miss-node-shape: `node ./nope.js` must emit
    // real Node's multi-line `Error: Cannot find module '<abs>'` + `{ code,
    // requireStack: [] }` on the child stderr (the kernel worker-entry writes
    // `err.stack`), NOT rifty's `ModuleLoadError` name + internal frames. The
    // entry has no requirer, so requireStack is empty (no `Require stack:` block).
    const vfs = new MemoryFsSync();
    vfs.mkdirSync('/w', { recursive: true });

    let thrown: unknown;
    try {
      await runNodeEntry({ vfs, entryPath: '/w/nope.js', cwd: '/w' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error & { code?: string; requireStack?: readonly string[] };
    expect(err.code).toBe('MODULE_NOT_FOUND');
    expect(err.requireStack).toEqual([]);
    expect(err.stack).toBe(
      "Error: Cannot find module '/w/nope.js'\n{\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}",
    );
  });

  it('does NOT fake-shape an ESM import() miss into the CJS form (Node uses ERR_MODULE_NOT_FOUND)', async () => {
    // A nested ESM `import` miss is a DIFFERENT Node error than CJS — real Node
    // emits `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<abs>' imported
    // from <parent>` (no requireStack, a `url` prop), NOT the CJS MODULE_NOT_FOUND
    // form. rifty does not emit that shape yet, so the honest rifty ModuleLoadError
    // must surface unchanged here — never masquerade as a (wrong) CJS Node error.
    // The entry-miss reshape stays correct: Node runs a missing `.mjs` entry
    // through the CJS loader (MODULE_NOT_FOUND), tested above.
    // TODO(backlog: runtime-js/esm-import-miss-err-module-not-found)
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/w/app.mjs': "import './missing.mjs';\n" });

    let thrown: unknown;
    try {
      await runNodeEntry({ vfs, entryPath: '/w/app.mjs', cwd: '/w' });
    } catch (e) {
      thrown = e;
    }

    const err = thrown as Error & { code?: string; requireStack?: readonly string[] };
    expect(err.code).toBe('MODULE_NOT_FOUND');
    expect(err.name).toBe('ModuleLoadError');
    expect(err.requireStack).toBeUndefined();
    expect(err.stack ?? '').not.toMatch(/^Error: Cannot find module/);
  });

  it('reshapes a NESTED require miss with a Node-faithful Require-stack block + populated requireStack', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/w/app.js': "require('./gone.js');\n" });

    let thrown: unknown;
    try {
      await runNodeEntry({ vfs, entryPath: '/w/app.js', cwd: '/w' });
    } catch (e) {
      thrown = e;
    }

    const err = thrown as Error & { code?: string; requireStack?: readonly string[] };
    expect(err.code).toBe('MODULE_NOT_FOUND');
    expect(err.requireStack).toEqual(['/w/app.js']);
    expect(err.stack).toBe(
      "Error: Cannot find module './gone.js'\n" +
        'Require stack:\n' +
        '- /w/app.js\n' +
        '{\n' +
        "  code: 'MODULE_NOT_FOUND',\n" +
        "  requireStack: [ '/w/app.js' ]\n" +
        '}',
    );
  });

  // Regression: a Node entry may call `module.createRequire(import.meta.url)`
  // (Rolldown's `wasi-worker.mjs` does, in a worker_threads pthread realm).
  // `runNodeEntry` must publish a `createRequire` impl backed by its loader, else
  // `createRequire` throws "no loader registered".
  it('registers a `createRequire` impl backed by the entry loader', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/dep.js': 'module.exports = { answer: 42 };\n',
      '/work/main.js': 'module.exports = {};\n',
    });
    await runNodeEntry({ vfs, entryPath: '/work/main.js', cwd: '/work' });

    // createRequire is now wired for this realm — resolve a sibling CJS module.
    const req = createRequire('/work/main.js') as (id: string) => { answer: number };
    expect(req('./dep.js').answer).toBe(42);
  });
});
