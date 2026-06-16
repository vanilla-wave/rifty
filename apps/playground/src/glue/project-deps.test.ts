import { MemoryFsSync, createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { type DepSnapshotV1, buildDepSnapshot } from './dep-snapshot.ts';
import { installStampSatisfied, writeInstallStamp } from './install-stamp.ts';
import { ensureProjectDependencies } from './project-deps.ts';

const ROOT = '/workspace';
const enc = new TextEncoder();

function viteSnapshot(): DepSnapshotV1 {
  const fs = new MemoryFsSync();
  fs.mkdirSync(`${ROOT}/node_modules/vite`, { recursive: true });
  fs.writeFileSync(`${ROOT}/node_modules/vite/package.json`, enc.encode('{"name":"vite"}'));
  fs.writeFileSync(`${ROOT}/package-lock.json`, enc.encode('{"lockfileVersion":3}'));
  return buildDepSnapshot(fs, ROOT, { templateId: 'vite', deps: { vite: '^5.4.0' }, packages: 8 });
}

function project(deps: Record<string, string> = { vite: '^5.4.0' }) {
  const { vfs, fsSync } = createMemoryFs();
  fsSync.mkdirSync(ROOT, { recursive: true });
  fsSync.writeFileSync(
    `${ROOT}/package.json`,
    enc.encode(JSON.stringify({ name: 'app', dependencies: deps })),
  );
  const log: string[] = [];
  return { vfs, fsSync, log, logFn: (line: string) => log.push(line) };
}

describe('ensureProjectDependencies (ADR-0135)', () => {
  it('reuses a stamp written under the SAME slug without fetching or installing', async () => {
    const { vfs, fsSync, log, logFn } = project();
    fsSync.mkdirSync(`${ROOT}/node_modules`, { recursive: true });
    await writeInstallStamp(vfs, ROOT, 8, 'project-files');

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => {
        throw new Error('must not fetch on a stamp hit');
      },
      install: async () => {
        throw new Error('must not install on a stamp hit');
      },
      flush: async () => {},
      log: logFn,
    });

    expect(result).toEqual({ source: 'stamp', packages: 8 });
    expect(log.join('')).toContain('install skipped');
  });

  it('ignores a stamp written under a DIFFERENT slug — the from-scratch install still runs', async () => {
    // project-files (instant) stamped OPFS for the shared vite deps; selecting
    // real-vite (from-scratch, no snapshot) must still install, not reuse.
    const { vfs, fsSync, log, logFn } = project();
    fsSync.mkdirSync(`${ROOT}/node_modules`, { recursive: true });
    await writeInstallStamp(vfs, ROOT, 8, 'project-files');
    let installed = false;

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'real-vite',
      fetchSnapshot: async () => {
        throw new Error('from-scratch must not consult the snapshot');
      },
      install: async () => {
        installed = true;
        return { packages: 8 };
      },
      flush: async () => {},
      log: logFn,
    });

    expect(result).toEqual({ source: 'install', packages: 8 });
    expect(installed).toBe(true);
    expect(log.join('')).not.toContain('install skipped');
    // re-selecting the SAME slug now reuses the tree it just stamped.
    expect((await installStampSatisfied(vfs, ROOT, 'real-vite'))?.packages).toBe(8);
  });

  it('restores the baked snapshot on a stampless boot and stamps the tree', async () => {
    const { vfs, fsSync, log, logFn } = project();
    let installed = false;

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      install: async () => {
        installed = true;
        return { packages: 0 };
      },
      flush: async () => {},
      log: logFn,
    });

    expect(result).toEqual({ source: 'snapshot', packages: 8 });
    expect(installed).toBe(false);
    expect(fsSync.existsSync(`${ROOT}/node_modules/vite/package.json`)).toBe(true);
    expect(fsSync.existsSync(`${ROOT}/package-lock.json`)).toBe(true);
    expect((await installStampSatisfied(vfs, ROOT, 'project-files'))?.packages).toBe(8);
    expect(log.join('')).toContain('baked node_modules restored');
  });

  it('falls back to install when the snapshot deps drift from package.json', async () => {
    const { vfs, fsSync, log, logFn } = project({ vite: '^6.0.0' });

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      install: async () => ({ packages: 9 }),
      flush: async () => {},
      log: logFn,
    });

    expect(result).toEqual({ source: 'install', packages: 9 });
    expect(log.join('')).toContain('stale');
    expect((await installStampSatisfied(vfs, ROOT, 'project-files'))?.packages).toBe(9);
  });

  it('falls back to install when the snapshot asset is unavailable', async () => {
    const { vfs, fsSync, log, logFn } = project();

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => null,
      install: async () => ({ packages: 9 }),
      flush: async () => {},
      log: logFn,
    });

    expect(result).toEqual({ source: 'install', packages: 9 });
    expect(log.join('')).toContain('unavailable');
  });

  it('installs directly when the template has no baked snapshot', async () => {
    const { vfs, fsSync, logFn } = project({ express: '^4.19.0' });

    const result = await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'express-sqlite',
      slug: 'express-sqlite',
      fetchSnapshot: async () => {
        throw new Error('must not fetch without a snapshot url');
      },
      install: async () => ({ packages: 60 }),
      flush: async () => {},
      log: logFn,
    });

    expect(result).toEqual({ source: 'install', packages: 60 });
    expect((await installStampSatisfied(vfs, ROOT, 'express-sqlite'))?.packages).toBe(60);
  });

  it('flush-before-stamp ordering holds on the snapshot path', async () => {
    const { vfs, fsSync, logFn } = project();
    const flushSawStamp: boolean[] = [];

    await ensureProjectDependencies({
      vfs,
      fsSync,
      root: ROOT,
      templateId: 'vite',
      slug: 'project-files',
      snapshotUrl: '/snapshots/vite.json.gz',
      fetchSnapshot: async () => viteSnapshot(),
      install: async () => ({ packages: 0 }),
      flush: async () => {
        flushSawStamp.push(fsSync.existsSync(`${ROOT}/node_modules/.rifty-install-stamp.json`));
      },
      log: logFn,
    });

    expect(flushSawStamp).toEqual([false, true]);
  });
});
