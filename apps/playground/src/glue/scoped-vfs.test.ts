import { type PersistFailureReport, syncMirror } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import {
  ScopedFsSync,
  ScopedVfs,
  scopeActiveVfsToWorkspace,
  workspaceVfsPrefix,
} from './scoped-vfs.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

afterEach(() => resetSyncMirror());

describe('workspace-scoped VFS', () => {
  it('maps public absolute paths under a workspace prefix', () => {
    const { fsSync } = createMemoryFs();
    const scoped = new ScopedFsSync(fsSync, workspaceVfsPrefix('ws/a:b'));

    scoped.mkdirSync('/scratch', { recursive: true });
    scoped.writeFileSync('/scratch/main.js', enc.encode('scoped'));

    expect(scoped.existsSync('/scratch/main.js')).toBe(true);
    expect(fsSync.existsSync('/scratch/main.js')).toBe(false);
    expect(fsSync.existsSync('/workspaces/ws_a_b/scratch/main.js')).toBe(true);
    expect(dec.decode(fsSync.readFileBytesSync('/workspaces/ws_a_b/scratch/main.js'))).toBe(
      'scoped',
    );
  });

  it('keeps two workspaces isolated while preserving their public paths', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const oneSync = new ScopedFsSync(fsSync, workspaceVfsPrefix('one'));
    const twoSync = new ScopedFsSync(fsSync, workspaceVfsPrefix('two'));
    const oneVfs = new ScopedVfs(vfs, workspaceVfsPrefix('one'));
    const twoVfs = new ScopedVfs(vfs, workspaceVfsPrefix('two'));

    oneSync.mkdirSync('/scratch', { recursive: true });
    twoSync.mkdirSync('/scratch', { recursive: true });
    oneSync.writeFileSync('/scratch/marker.txt', enc.encode('one'));
    await twoVfs.writeFile('/scratch/marker.txt', 'two');

    expect(dec.decode(oneSync.readFileBytesSync('/scratch/marker.txt'))).toBe('one');
    expect(await twoVfs.readFileText('/scratch/marker.txt')).toBe('two');
    expect(await oneVfs.readFileText('/scratch/marker.txt')).toBe('one');
    expect(dec.decode(twoSync.readFileBytesSync('/scratch/marker.txt'))).toBe('two');
  });

  it('re-wires the active sync mirror under the workspace prefix', () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });

    expect(scopeActiveVfsToWorkspace('active')).toBe('/workspaces/active');
    syncMirror().mkdirSync('/scratch', { recursive: true });
    syncMirror().writeFileSync('/scratch/marker.txt', enc.encode('active'));

    expect(fsSync.existsSync('/scratch/marker.txt')).toBe(false);
    expect(fsSync.existsSync('/workspaces/active/scratch/marker.txt')).toBe(true);
  });

  it('passes through the inner OPFS persist-failure report instead of hiding durability gaps', async () => {
    const { fsSync } = createMemoryFs();
    const report: PersistFailureReport = {
      failures: [
        {
          path: '/workspaces/active/proj/node_modules/pkg/package.json',
          op: 'write',
          message: 'QuotaExceededError',
        },
      ],
      total: 1,
      anyFailure(predicate) {
        return this.failures.some((f) => predicate(f.path));
      },
    };
    (fsSync as typeof fsSync & { flush: () => Promise<PersistFailureReport> }).flush = async () =>
      report;

    const scoped = new ScopedFsSync(fsSync, workspaceVfsPrefix('active'));

    await expect(scoped.flush()).resolves.toBe(report);
  });
});
