import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import {
  emnapiCoreOrphanedReferencePatchApplied,
  emnapiCoreOrphanedReferencePatchPolicy,
} from './emnapi-core-install-policy.ts';
import {
  finalizePackageInstallFiles,
  finalizerPackagesFromLockfile,
} from './package-install-finalizer.ts';
import { finalizeGenericPackageInstallFiles } from './package-install-generic-finalizer.ts';
import { viteCliActionPatchApplied, viteRootWatchPatchApplied } from './vite-cli-install-policy.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const CLI_SOURCE = 'class Cli { parse() { this.runMatchedCommand(); } }';
const ROOT_WATCH_SOURCE = [
  'const EMPTY_STR = "";',
  'const ONE_DOT = ".";',
  'const TWO_DOTS = "..";',
  'if (item !== ONE_DOT && item !== TWO_DOTS) items.add(item);',
].join('\n');

function seedViteFiles(
  fsSync: ReturnType<typeof createMemoryFs>['fsSync'],
  root: string,
): { cli: string; watcher: string } {
  const cli = `${root}/node_modules/vite/dist/node/cli.js`;
  const watcher = `${root}/node_modules/vite/dist/node/chunks/config.js`;
  fsSync.mkdirSync(`${root}/node_modules/vite/dist/node/chunks`, { recursive: true });
  fsSync.writeFileSync(cli, enc.encode(CLI_SOURCE));
  fsSync.writeFileSync(watcher, enc.encode(ROOT_WATCH_SOURCE));
  return { cli, watcher };
}

function seedEmnapiCore(
  fsSync: ReturnType<typeof createMemoryFs>['fsSync'],
  root: string,
  installPath: string,
): { readable: string; minified: string } {
  const packageRoot = `${root}/${installPath}`;
  const readable = `${packageRoot}/dist/emnapi-core.cjs.js`;
  const minified = `${packageRoot}/dist/emnapi-core.cjs.min.js`;
  fsSync.mkdirSync(`${packageRoot}/dist`, { recursive: true });
  fsSync.writeFileSync(
    readable,
    enc.encode(
      emnapiCoreOrphanedReferencePatchPolicy.readable.map((site) => site.needle).join('\n'),
    ),
  );
  fsSync.writeFileSync(
    minified,
    enc.encode(
      emnapiCoreOrphanedReferencePatchPolicy.minified.map((site) => site.needle).join(';'),
    ),
  );
  return { readable, minified };
}

afterEach(() => resetSyncMirror());

describe('finalizePackageInstallFiles', () => {
  it('recovers hoisted and nested @emnapi/core copies from npm v3 lock paths', () => {
    expect(
      finalizerPackagesFromLockfile({
        lockfileVersion: 3,
        packages: {
          '': { name: 'app' },
          'node_modules/@emnapi/core': { version: '1.10.0' },
          'node_modules/tool/node_modules/@emnapi/core': { version: '1.11.3' },
          'node_modules/other': { version: '1.0.0' },
        },
      }),
    ).toEqual([
      { version: '1.10.0', installPath: 'node_modules/@emnapi/core' },
      { version: '1.11.3', installPath: 'node_modules/tool/node_modules/@emnapi/core' },
    ]);
  });

  it('patches Vite at an arbitrary non-preset project root before promotion can follow', async () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });
    const paths = seedViteFiles(fsSync, '/scratch/nested');

    await finalizePackageInstallFiles({ root: '/scratch/nested' });

    expect(viteCliActionPatchApplied(dec.decode(fsSync.readFileBytesSync(paths.cli)))).toBe(true);
    expect(viteRootWatchPatchApplied(dec.decode(fsSync.readFileBytesSync(paths.watcher)))).toBe(
      true,
    );
  });

  it('generic finalization leaves Vite bytes untouched', () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });
    const paths = seedViteFiles(fsSync, '/build-only');

    finalizeGenericPackageInstallFiles({ root: '/build-only' });

    expect(dec.decode(fsSync.readFileBytesSync(paths.cli))).toBe(CLI_SOURCE);
    expect(dec.decode(fsSync.readFileBytesSync(paths.watcher))).toBe(ROOT_WATCH_SOURCE);
    expect(viteRootWatchPatchApplied(dec.decode(fsSync.readFileBytesSync(paths.watcher)))).toBe(
      false,
    );
  });

  it('seeds template files before preparing the installed Vite CLI', async () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });
    let paths: { cli: string; watcher: string } | undefined;

    await finalizePackageInstallFiles({
      root: '/scratch/nested',
      seedTemplateFiles: () => {
        paths = seedViteFiles(fsSync, '/scratch/nested');
      },
    });

    if (!paths) throw new Error('seedTemplateFiles was not called');
    expect(viteCliActionPatchApplied(dec.decode(fsSync.readFileBytesSync(paths.cli)))).toBe(true);
    expect(viteRootWatchPatchApplied(dec.decode(fsSync.readFileBytesSync(paths.watcher)))).toBe(
      true,
    );
  });

  it('patches every pinned @emnapi/core 1.10 copy at its real hoisted or nested path', async () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });
    const root = '/scratch/nested';
    const copies = [
      {
        installPath: 'node_modules/@emnapi/core',
        files: seedEmnapiCore(fsSync, root, 'node_modules/@emnapi/core'),
      },
      {
        installPath: 'node_modules/tool/node_modules/@emnapi/core',
        files: seedEmnapiCore(fsSync, root, 'node_modules/tool/node_modules/@emnapi/core'),
      },
    ];
    fsSync.writeFileSync(
      `${root}/package-lock.json`,
      enc.encode(
        JSON.stringify({
          lockfileVersion: 3,
          packages: Object.fromEntries(
            copies.map(({ installPath }) => [installPath, { version: '1.10.0' }]),
          ),
        }),
      ),
    );

    await finalizePackageInstallFiles({ root });

    for (const { files } of copies) {
      expect(
        emnapiCoreOrphanedReferencePatchApplied(
          dec.decode(fsSync.readFileBytesSync(files.readable)),
          'readable',
        ),
      ).toBe(true);
      expect(
        emnapiCoreOrphanedReferencePatchApplied(
          dec.decode(fsSync.readFileBytesSync(files.minified)),
          'minified',
        ),
      ).toBe(true);
    }
  });

  it('rejects a drifted @emnapi/core 1.10 artifact before promotion', async () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });
    const packageRoot = '/scratch/node_modules/@emnapi/core';
    fsSync.mkdirSync(`${packageRoot}/dist`, { recursive: true });
    fsSync.writeFileSync(`${packageRoot}/dist/emnapi-core.cjs.js`, enc.encode('drifted'));
    fsSync.writeFileSync(`${packageRoot}/dist/emnapi-core.cjs.min.js`, enc.encode('drifted'));
    fsSync.writeFileSync(
      '/scratch/package-lock.json',
      enc.encode(
        JSON.stringify({
          lockfileVersion: 3,
          packages: { 'node_modules/@emnapi/core': { version: '1.10.0' } },
        }),
      ),
    );

    await expect(finalizePackageInstallFiles({ root: '/scratch' })).rejects.toThrow(
      '@emnapi/core orphaned-reference patch failed: readable anchors drifted',
    );
  });

  it('performs zero writes for a generic non-Vite install', async () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });
    fsSync.mkdirSync('/scratch/nested/node_modules/plain', { recursive: true });
    const realWrite = fsSync.writeFileSync.bind(fsSync);
    const writes: string[] = [];
    fsSync.writeFileSync = (path, data) => {
      writes.push(path);
      realWrite(path, data);
    };

    await finalizePackageInstallFiles({ root: '/scratch/nested' });

    expect(writes).toEqual([]);
  });
});
