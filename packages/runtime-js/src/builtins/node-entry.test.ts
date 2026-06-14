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
});
