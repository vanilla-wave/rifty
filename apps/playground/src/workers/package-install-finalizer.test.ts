import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { finalizePackageInstallFiles } from './package-install-finalizer.ts';
import { viteCliActionPatchApplied } from './vite-cli-install-policy.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const CLI_SOURCE = 'class Cli { parse() { this.runMatchedCommand(); } }';

afterEach(() => resetSyncMirror());

describe('finalizePackageInstallFiles', () => {
  it('patches Vite at an arbitrary non-preset project root before promotion can follow', async () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });
    const path = '/scratch/nested/node_modules/vite/dist/node/cli.js';
    fsSync.mkdirSync('/scratch/nested/node_modules/vite/dist/node', { recursive: true });
    fsSync.writeFileSync(path, enc.encode(CLI_SOURCE));

    await finalizePackageInstallFiles({ root: '/scratch/nested' });

    expect(viteCliActionPatchApplied(dec.decode(fsSync.readFileBytesSync(path)))).toBe(true);
  });

  it('seeds template files before preparing the installed Vite CLI', async () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });
    const path = '/scratch/nested/node_modules/vite/dist/node/cli.js';

    await finalizePackageInstallFiles({
      root: '/scratch/nested',
      seedTemplateFiles: () => {
        fsSync.mkdirSync('/scratch/nested/node_modules/vite/dist/node', { recursive: true });
        fsSync.writeFileSync(path, enc.encode(CLI_SOURCE));
      },
    });

    expect(viteCliActionPatchApplied(dec.decode(fsSync.readFileBytesSync(path)))).toBe(true);
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
