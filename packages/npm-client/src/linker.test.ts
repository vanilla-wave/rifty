import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { type ResolvedPackage, link } from './linker.ts';

const enc = new TextEncoder();

function pkg(name: string, files: Record<string, string>, installPath?: string): ResolvedPackage {
  const fileBytes: Record<string, Uint8Array> = {};
  for (const [p, body] of Object.entries(files)) fileBytes[p] = enc.encode(body);
  return { name, version: '1.0.0', files: fileBytes, dependencies: {}, installPath };
}

describe('linker — dir dedup + parallel writes (#7, perf-audit 2026-06-05)', () => {
  it('pre-creates distinct dirs once, not per-file (O(K) not O(M*D))', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    // A package whose files span several distinct parent dirs, with MANY files
    // sharing each dir — the regression-to-per-file-mkdir guard is that mkdir
    // count tracks distinct dirs, not file count.
    const libFiles: Record<string, string> = { 'package.json': '{}' };
    for (let i = 0; i < 10; i++) libFiles[`lib/m${i}.js`] = `// ${i}`;
    for (let i = 0; i < 10; i++) libFiles[`lib/sub/s${i}.js`] = `// sub ${i}`;
    libFiles['bin/cli.js'] = '#!/usr/bin/env node';

    const packages = [
      pkg('alpha', libFiles, 'node_modules/alpha'),
      // second package at a nested install path — adds its own distinct dirs
      pkg(
        'beta',
        { 'package.json': '{}', 'dist/index.js': 'x' },
        'node_modules/alpha/node_modules/beta',
      ),
    ];

    const spy = vi.spyOn(vfs, 'mkdir');
    await link(vfs, '/proj', packages);

    // 23 files in alpha across 4 distinct dirs (root, lib, lib/sub, bin);
    // beta across 2 distinct dirs (its root, dist). mkdir calls = the initial
    // node_modules mkdir (1) + the distinct dirs (4 + 2). It must NOT scale with
    // the ~25 total files.
    const dirMkdirCalls = spy.mock.calls.length;
    expect(dirMkdirCalls).toBe(1 + 4 + 2);
    // Hard upper-bound guard against any regression to per-file mkdir.
    const totalFiles = Object.keys(libFiles).length + 2;
    expect(dirMkdirCalls).toBeLessThan(totalFiles);

    spy.mockRestore();
  });

  it('lands every file with correct bytes across multiple nested dirs', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    const packages = [
      pkg(
        'm',
        {
          'package.json': '{"name":"m"}',
          'lib/a.js': 'AAA',
          'lib/sub/b.js': 'BBB',
          'bin/run': 'RUN',
        },
        'node_modules/m',
      ),
    ];

    await link(vfs, '/proj', packages);

    expect(await vfs.readFileText('/proj/node_modules/m/package.json')).toBe('{"name":"m"}');
    expect(await vfs.readFileText('/proj/node_modules/m/lib/a.js')).toBe('AAA');
    expect(await vfs.readFileText('/proj/node_modules/m/lib/sub/b.js')).toBe('BBB');
    expect(await vfs.readFileText('/proj/node_modules/m/bin/run')).toBe('RUN');
  });
});
