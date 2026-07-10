import { type PersistFailureReport, syncMirror } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import {
  ScopedFsSync,
  ScopedVfs,
  type WorkspaceMutation,
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

  it('reports successful sync workspace mutations but not reads or semantic no-ops', () => {
    const { fsSync } = createMemoryFs();
    const mutations: WorkspaceMutation[] = [];
    const scoped = new ScopedFsSync(fsSync, workspaceVfsPrefix('observed'), (mutation) =>
      mutations.push(mutation),
    );

    scoped.mkdirSync('/scratch', { recursive: true });
    mutations.length = 0;

    expect(scoped.existsSync('/scratch')).toBe(true);
    expect(scoped.readdirSync('/scratch')).toEqual([]);
    expect(scoped.statSync('/scratch').isDirectory).toBe(true);
    scoped.mkdirSync('/scratch', { recursive: true });
    scoped.rmSync('/scratch/missing.txt', { force: true });
    scoped.renameSync('/scratch', '/scratch');
    expect(() => scoped.writeFileSync('/missing/a.txt', enc.encode('nope'))).toThrow();
    expect(mutations).toEqual([]);

    scoped.writeFileSync('/scratch/a.txt', enc.encode('a'));
    scoped.copyFileSync('/scratch/a.txt', '/scratch/b.txt');
    scoped.renameSync('/scratch/b.txt', '/scratch/c.txt');
    scoped.rmSync('/scratch/c.txt', {});

    expect(mutations).toEqual([
      { op: 'write', paths: ['/scratch/a.txt'], intent: 'protect' },
      { op: 'copy', paths: ['/scratch/b.txt'], intent: 'protect' },
      { op: 'rename', paths: ['/scratch/b.txt', '/scratch/c.txt'], intent: 'protect' },
      { op: 'rm', paths: ['/scratch/c.txt'], intent: 'protect' },
    ]);
  });

  it('reports successful async workspace mutations after the backing operation settles', async () => {
    const { vfs } = createMemoryFs();
    const mutations: WorkspaceMutation[] = [];
    const scoped = new ScopedVfs(vfs, workspaceVfsPrefix('observed-async'), (mutation) =>
      mutations.push(mutation),
    );

    await scoped.mkdir('/scratch', { recursive: true });
    mutations.length = 0;
    await scoped.mkdir('/scratch', { recursive: true });
    await scoped.rm('/scratch/missing.txt', { force: true });
    await scoped.writeFile('/scratch/a.txt', 'a');
    await scoped.rm('/scratch/a.txt');

    expect(mutations).toEqual([
      { op: 'write', paths: ['/scratch/a.txt'], intent: 'protect' },
      { op: 'rm', paths: ['/scratch/a.txt'], intent: 'protect' },
    ]);
  });

  it('carries explicit baseline intent without ambient suppression', () => {
    const { fsSync } = createMemoryFs();
    const mutations: WorkspaceMutation[] = [];
    const baseline = new ScopedFsSync(
      fsSync,
      workspaceVfsPrefix('baseline'),
      (mutation) => mutations.push(mutation),
      'baseline',
    );

    baseline.mkdirSync('/scratch', { recursive: true });
    baseline.writeFileSync('/scratch/main.js', enc.encode('starter'));

    expect(mutations).toEqual([
      { op: 'mkdir', paths: ['/scratch'], intent: 'baseline' },
      { op: 'write', paths: ['/scratch/main.js'], intent: 'baseline' },
    ]);
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

  it('keeps .rifty owner metadata profile-wide across workspace scopes', async () => {
    const { vfs, fsSync } = createMemoryFs();
    const oneSync = new ScopedFsSync(fsSync, workspaceVfsPrefix('one'));
    const twoVfs = new ScopedVfs(vfs, workspaceVfsPrefix('two'));

    oneSync.mkdirSync('/.rifty', { recursive: true });
    oneSync.writeFileSync('/.rifty/eddy-learned-pins.json', enc.encode('pins'));

    expect(fsSync.existsSync('/.rifty/eddy-learned-pins.json')).toBe(true);
    expect(fsSync.existsSync('/workspaces/one/.rifty/eddy-learned-pins.json')).toBe(false);
    expect(await twoVfs.readFileText('/.rifty/eddy-learned-pins.json')).toBe('pins');
  });

  it('re-wires the active sync mirror under the workspace prefix', () => {
    const { vfs, fsSync } = createMemoryFs();
    setSyncMirror(fsSync, { async: vfs });

    expect(scopeActiveVfsToWorkspace('active').prefix).toBe('/workspaces/active');
    syncMirror().mkdirSync('/scratch', { recursive: true });
    syncMirror().writeFileSync('/scratch/marker.txt', enc.encode('active'));

    expect(fsSync.existsSync('/scratch/marker.txt')).toBe(false);
    expect(fsSync.existsSync('/workspaces/active/scratch/marker.txt')).toBe(true);
  });

  it('remaps inner OPFS persist-failure paths back to public workspace paths', async () => {
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
    const flushed = await scoped.flush();

    expect(flushed?.failures).toEqual([
      {
        path: '/proj/node_modules/pkg/package.json',
        op: 'write',
        message: 'QuotaExceededError',
      },
    ]);
    expect(flushed?.total).toBe(1);
    expect(flushed?.anyFailure?.((path) => path === '/proj/node_modules/pkg/package.json')).toBe(
      true,
    );
    expect(flushed?.anyFailure?.((path) => path.startsWith('/workspaces/active'))).toBe(false);
  });
});
