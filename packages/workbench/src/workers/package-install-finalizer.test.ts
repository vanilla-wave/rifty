import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { finalizePackageInstallFiles } from './package-install-finalizer.ts';
import { viteCliActionPatchApplied, viteRootWatchPatchApplied } from './vite-cli-install-policy.ts';
import { viteConfigTempPatchApplied, viteConfigTempPatchPolicy } from './vite-config-temp-patch.ts';

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
  const policy = viteConfigTempPatchPolicy.sources[0];
  fsSync.mkdirSync(`${root}/node_modules/vite/dist/node/chunks`, { recursive: true });
  fsSync.writeFileSync(
    `${root}/node_modules/vite/package.json`,
    enc.encode(JSON.stringify({ name: 'vite', version: policy.version })),
  );
  fsSync.writeFileSync(cli, enc.encode(CLI_SOURCE));
  fsSync.writeFileSync(watcher, enc.encode(`${ROOT_WATCH_SOURCE}\n${policy.upstreamBlock}`));
  return { cli, watcher };
}

afterEach(() => resetSyncMirror());

describe('finalizePackageInstallFiles', () => {
  it('patches Vite at an arbitrary non-preset project root before promotion can follow', async () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });
    const paths = seedViteFiles(fsSync, '/scratch/nested');

    await finalizePackageInstallFiles({ root: '/scratch/nested' });

    expect(viteCliActionPatchApplied(dec.decode(fsSync.readFileBytesSync(paths.cli)))).toBe(true);
    expect(viteRootWatchPatchApplied(dec.decode(fsSync.readFileBytesSync(paths.watcher)))).toBe(
      true,
    );
    expect(
      viteConfigTempPatchApplied(dec.decode(fsSync.readFileBytesSync(paths.watcher)), '7.3.6'),
    ).toBe(true);
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
