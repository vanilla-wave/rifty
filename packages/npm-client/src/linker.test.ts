import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { type ResolvedPackage, link, linkInstallTree } from './linker.ts';

const enc = new TextEncoder();

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function pkg(
  name: string,
  files: Record<string, string>,
  installPath?: string,
  bin?: ResolvedPackage['bin'],
): ResolvedPackage {
  const fileBytes: Record<string, Uint8Array> = {};
  for (const [p, body] of Object.entries(files)) fileBytes[p] = enc.encode(body);
  return { name, version: '1.0.0', files: fileBytes, dependencies: {}, installPath, bin };
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

  it('[fault: observable-order] settles every sibling write before surfacing the first error', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const secondStarted = deferred<void>();
    const releaseSecond = deferred<void>();
    const firstFailure = new Error('first write failed');
    const writeFile = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      if (path.endsWith('/a.js')) throw firstFailure;
      if (path.endsWith('/b.js')) {
        secondStarted.resolve();
        await releaseSecond.promise;
      }
      await writeFile(path, data);
    });

    let settled = false;
    const linking = link(vfs, '/proj', [
      pkg('writes', { 'a.js': 'A', 'b.js': 'B' }, 'node_modules/writes'),
    ]).finally(() => {
      settled = true;
    });
    void linking.catch(() => {});
    await secondStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    releaseSecond.resolve();
    await expect(linking).rejects.toBe(firstFailure);
    expect(await vfs.readFileText('/proj/node_modules/writes/b.js')).toBe('B');
  });

  it('[fault: torn-state] gives an observed abort priority after sibling writes settle', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const secondStarted = deferred<void>();
    const releaseSecond = deferred<void>();
    const writeFailure = new Error('write failed during cancellation');
    const writeFile = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation(async (path, data) => {
      if (path.endsWith('/a.js')) throw writeFailure;
      if (path.endsWith('/b.js')) {
        secondStarted.resolve();
        await releaseSecond.promise;
      }
      await writeFile(path, data);
    });
    const controller = new AbortController();
    const abortReason = new Error('cancel link');
    const checkpoint = (): void => {
      if (controller.signal.aborted) throw controller.signal.reason;
    };

    const linking = linkInstallTree(
      vfs,
      '/proj',
      [pkg('writes', { 'a.js': 'A', 'b.js': 'B' }, 'node_modules/writes')],
      checkpoint,
    );
    await secondStarted.promise;
    controller.abort(abortReason);
    releaseSecond.resolve();

    await expect(linking).rejects.toBe(abortReason);
  });
});

describe('linker — node_modules/.bin launcher shims', () => {
  it('writes launcher shims (not byte copies) so the real bin keeps relative resolution', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    await link(vfs, '/proj', [
      pkg(
        'vite',
        {
          'package.json': '{"name":"vite"}',
          'bin/vite.js': '#!/usr/bin/env node\nconsole.log("vite");\n',
        },
        'node_modules/vite',
        'bin/vite.js',
      ),
      pkg(
        'typescript',
        {
          'package.json': '{"name":"typescript"}',
          'bin/tsc': '#!/usr/bin/env node\nconsole.log("tsc");\n',
          'bin/tsserver': '#!/usr/bin/env node\nconsole.log("tsserver");\n',
        },
        'node_modules/typescript',
        { tsc: 'bin/tsc', tsserver: './bin/tsserver' },
      ),
      pkg(
        'nested-cli',
        {
          'package.json': '{"name":"nested-cli"}',
          'bin/nested': '#!/usr/bin/env node\nconsole.log("nested");\n',
        },
        'node_modules/vite/node_modules/nested-cli',
        { nested: 'bin/nested' },
      ),
    ]);

    expect(await vfs.readFileText('/proj/node_modules/.bin/vite')).toBe(
      "#!/usr/bin/env node\nimport('../vite/bin/vite.js');\n",
    );
    expect(await vfs.readFileText('/proj/node_modules/.bin/tsc')).toBe(
      "#!/usr/bin/env node\nimport('../typescript/bin/tsc');\n",
    );
    expect(await vfs.readFileText('/proj/node_modules/.bin/tsserver')).toBe(
      "#!/usr/bin/env node\nimport('../typescript/bin/tsserver');\n",
    );
    expect(await vfs.readFileText('/proj/node_modules/vite/node_modules/.bin/nested')).toBe(
      "#!/usr/bin/env node\nimport('../nested-cli/bin/nested');\n",
    );
  });

  it('fails loudly when the manifest bin target is missing from the tarball', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });

    await expect(
      link(vfs, '/proj', [
        pkg('liar', { 'package.json': '{"name":"liar"}' }, 'node_modules/liar', 'bin/ghost.js'),
      ]),
    ).rejects.toThrow(/ghost\.js/);
  });

  it('[fault: torn-state] does not write a bin shim after cancellation during target read', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    const readStarted = deferred<void>();
    const releaseRead = deferred<void>();
    const readFile = vfs.readFile.bind(vfs);
    vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
      if (path.endsWith('/bin/cli.js')) {
        readStarted.resolve();
        await releaseRead.promise;
      }
      return readFile(path);
    });
    const controller = new AbortController();
    const abortReason = new Error('cancel bin link');
    const linking = linkInstallTree(
      vfs,
      '/proj',
      [
        pkg(
          'cli',
          {
            'package.json': '{"name":"cli"}',
            'bin/cli.js': '#!/usr/bin/env node\n',
          },
          'node_modules/cli',
          'bin/cli.js',
        ),
      ],
      () => {
        if (controller.signal.aborted) throw controller.signal.reason;
      },
    );

    await readStarted.promise;
    controller.abort(abortReason);
    releaseRead.resolve();

    await expect(linking).rejects.toBe(abortReason);
    await expect(vfs.exists('/proj/node_modules/.bin/cli')).resolves.toBe(false);
  });
});
