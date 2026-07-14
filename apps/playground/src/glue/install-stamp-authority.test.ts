import {
  type FsSync,
  MemoryVfs,
  OpfsFsSync,
  type PersistFailureReport,
  type Vfs,
} from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type OwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from '../workers/owner-vfs-authority.ts';
import {
  type InstallStampAuthority,
  type InstallStampClaimIo,
  createInstallStampAuthority,
} from './install-stamp-authority.ts';
import { installStampPath, readInstallStamp } from './install-stamp.ts';
import { SyncMirrorVfs } from './sync-mirror-vfs.ts';

const ROOT = '/proj';
const COPIED_ROOT = '/copied-proj';
const PACKAGE_JSON = `${JSON.stringify({
  name: 'app',
  dependencies: { vite: '^5.4.0' },
  overrides: { vite: '5.4.21' },
})}\n`;

interface AuthorityHarness {
  readonly vfs: MemoryVfs | SyncMirrorVfs;
  readonly fsSync?: FsSync;
  readonly flush?: () => Promise<PersistFailureReport | undefined>;
  readonly dispose: () => void;
}

function memoryVfsHarness(): AuthorityHarness {
  return { vfs: new MemoryVfs(), dispose: () => {} };
}

function syncMirrorHarness(): AuthorityHarness {
  const pair = createMemoryFs();
  setSyncMirror(pair.fsSync, { async: pair.vfs });
  return {
    vfs: new SyncMirrorVfs(),
    fsSync: pair.fsSync,
    dispose: resetSyncMirror,
  };
}

function fakeOpfsRoot(): FileSystemDirectoryHandle {
  const root = {
    kind: 'directory',
    name: '',
    getDirectoryHandle: async () => root,
    removeEntry: async () => {},
  };
  return root as unknown as FileSystemDirectoryHandle;
}

function opfsPairHarness(): AuthorityHarness {
  const durableFiles = new Map<string, Uint8Array>();
  const supported = vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  const fsSync = new OpfsFsSync(fakeOpfsRoot(), {
    readFile: async (path) => {
      const bytes = durableFiles.get(path);
      if (!bytes) throw new Error(`ENOENT: ${path}`);
      return bytes.slice();
    },
    writeFile: async (path, data) => {
      durableFiles.set(path, data.slice());
    },
    rm: async (path, options) => {
      durableFiles.delete(path);
      if (options?.recursive) {
        for (const key of [...durableFiles.keys()]) {
          if (key.startsWith(`${path}/`)) durableFiles.delete(key);
        }
      }
    },
  });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(fsSync, { async: vfs });
  return {
    vfs,
    fsSync,
    flush: () => fsSync.flush(),
    dispose: () => {
      supported.mockRestore();
      resetSyncMirror();
    },
  };
}

const implementations = [
  ['MemoryVfs', memoryVfsHarness],
  ['SyncMirrorVfs', syncMirrorHarness],
  ['OpfsFsSync pair', opfsPairHarness],
] as const;

interface OwnerCopyHarness {
  readonly vfs: Vfs;
  readonly owner: OwnerVfsAuthority;
  readonly claims: InstallStampClaimIo;
  readonly flush?: () => Promise<PersistFailureReport | undefined>;
  readonly restartOwner: () => Pick<OwnerCopyHarness, 'owner' | 'claims'>;
  readonly dispose: () => void;
}

function ownerComposition(
  fsSync: FsSync,
  ownerEpoch: string,
): { readonly owner: OwnerVfsAuthority; readonly claims: InstallStampClaimIo } {
  const composition = createOwnerVfsAuthorityComposition(fsSync, { ownerEpoch });
  return { owner: composition.authority, claims: composition.installStampClaims };
}

function memoryOwnerCopyHarness(): OwnerCopyHarness {
  const pair = createMemoryFs();
  const first = ownerComposition(pair.fsSync, 'memory-owner-before-restart');
  return {
    vfs: pair.vfs,
    ...first,
    flush: async () => undefined,
    restartOwner: () => ownerComposition(pair.fsSync, 'memory-owner-after-restart'),
    dispose: () => {},
  };
}

function syncMirrorOwnerCopyHarness(): OwnerCopyHarness {
  const pair = createMemoryFs();
  const install = (epoch: string) => {
    const composition = ownerComposition(pair.fsSync, epoch);
    setSyncMirror(composition.owner);
    return composition;
  };
  const first = install('sync-mirror-owner-before-restart');
  return {
    vfs: new SyncMirrorVfs(),
    ...first,
    flush: async () => undefined,
    restartOwner: () => install('sync-mirror-owner-after-restart'),
    dispose: resetSyncMirror,
  };
}

function opfsOwnerCopyHarness(): OwnerCopyHarness {
  const durableFiles = new Map<string, Uint8Array>();
  const supported = vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
  const fsSync = new OpfsFsSync(fakeOpfsRoot(), {
    readFile: async (path) => {
      const bytes = durableFiles.get(path);
      if (!bytes) throw new Error(`ENOENT: ${path}`);
      return bytes.slice();
    },
    writeFile: async (path, data) => {
      durableFiles.set(path, data.slice());
    },
    rm: async (path, options) => {
      durableFiles.delete(path);
      if (options?.recursive) {
        for (const key of [...durableFiles.keys()]) {
          if (key.startsWith(`${path}/`)) durableFiles.delete(key);
        }
      }
    },
  });
  const install = (epoch: string) => {
    const composition = ownerComposition(fsSync, epoch);
    setSyncMirror(composition.owner);
    return composition;
  };
  const first = install('opfs-owner-before-restart');
  return {
    vfs: new SyncMirrorVfs(),
    ...first,
    flush: () => fsSync.flush(),
    restartOwner: () => install('opfs-owner-after-restart'),
    dispose: () => {
      resetSyncMirror();
      supported.mockRestore();
    },
  };
}

const ownerCopyImplementations = [
  ['MemoryVfs', memoryOwnerCopyHarness],
  ['SyncMirrorVfs', syncMirrorOwnerCopyHarness],
  ['OpfsFsSync pair', opfsOwnerCopyHarness],
] as const;

async function seed(h: AuthorityHarness): Promise<void> {
  await h.vfs.mkdir(`${ROOT}/node_modules/vite`, { recursive: true });
  await h.vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
  await h.vfs.writeFile(`${ROOT}/node_modules/vite/package.json`, '{}\n');
  await h.flush?.();
}

function authority(h: AuthorityHarness): InstallStampAuthority {
  return createInstallStampAuthority({ vfs: h.vfs, ...(h.fsSync ? { fsSync: h.fsSync } : {}) });
}

afterEach(() => {
  vi.restoreAllMocks();
  resetSyncMirror();
});

describe.each(ownerCopyImplementations)(
  'root-bound claim copy contract — %s',
  (_name, makeHarness) => {
    const sourceRoot = '/copy-source';
    const copiedRoot = '/copy-target';
    const nestedSuffix = 'examples/nested-project';
    const nestedSourceRoot = `${sourceRoot}/${nestedSuffix}`;
    const nestedCopiedRoot = `${copiedRoot}/${nestedSuffix}`;
    const packageJson = `${JSON.stringify({
      name: 'copy-source',
      version: '1.0.0',
      dependencies: { dep: '1.0.0' },
    })}\n`;

    async function mintTrusted(
      stampAuthority: InstallStampAuthority,
      root: string,
      slug: string,
      flush: () => Promise<PersistFailureReport | undefined>,
    ): Promise<void> {
      const claim = await stampAuthority.demote({ root, slug }, { flush });
      await expect(
        stampAuthority.promote(
          { root, slug, packageJsonText: packageJson },
          { epoch: claim.epoch, packages: 1, flush },
        ),
      ).resolves.toMatchObject({ status: 'trusted' });
    }

    it('rejects direct claim copy and omits top+nested claims across copy, flush, and restart', async () => {
      const h = makeHarness();
      try {
        const flush = h.flush ?? (async () => undefined);
        h.owner.mkdirSync(`${sourceRoot}/node_modules/dep`, { recursive: true });
        h.owner.writeFileSync(`${sourceRoot}/package.json`, new TextEncoder().encode(packageJson));
        h.owner.writeFileSync(
          `${sourceRoot}/node_modules/dep/package.json`,
          new TextEncoder().encode('{"name":"dep","version":"1.0.0"}\n'),
        );
        h.owner.mkdirSync(`${nestedSourceRoot}/node_modules/dep`, { recursive: true });
        h.owner.writeFileSync(
          `${nestedSourceRoot}/package.json`,
          new TextEncoder().encode(packageJson),
        );
        h.owner.writeFileSync(
          `${nestedSourceRoot}/node_modules/dep/package.json`,
          new TextEncoder().encode('{"name":"dep","version":"1.0.0"}\n'),
        );

        const first = createInstallStampAuthority({
          vfs: h.vfs,
          fsSync: h.owner,
          claimIo: h.claims,
        });
        await mintTrusted(first, sourceRoot, 'source-project', flush);
        await mintTrusted(first, nestedSourceRoot, 'nested-project', flush);

        expect(() =>
          h.owner.copyFileSync(installStampPath(sourceRoot), installStampPath(copiedRoot)),
        ).toThrowError(/EPERM/);
        expect(h.owner.existsSync(copiedRoot)).toBe(false);

        h.owner.cpSync(sourceRoot, copiedRoot, { recursive: true });

        expect(h.owner.readFileBytesSync(`${copiedRoot}/package.json`)).toEqual(
          new TextEncoder().encode(packageJson),
        );
        expect(h.owner.existsSync(installStampPath(copiedRoot))).toBe(false);
        expect(h.owner.existsSync(installStampPath(nestedCopiedRoot))).toBe(false);
        expect(h.owner.existsSync(installStampPath(sourceRoot))).toBe(true);
        expect(h.owner.existsSync(installStampPath(nestedSourceRoot))).toBe(true);

        await flush();
        const restarted = h.restartOwner();
        const afterRestart = createInstallStampAuthority({
          vfs: h.vfs,
          fsSync: restarted.owner,
          claimIo: restarted.claims,
        });

        await expect(
          afterRestart.check({ root: sourceRoot, slug: 'source-project' }),
        ).resolves.toMatchObject({ status: 'trusted' });
        await expect(
          afterRestart.check({ root: nestedSourceRoot, slug: 'nested-project' }),
        ).resolves.toMatchObject({ status: 'trusted' });
        await expect(
          afterRestart.check({ root: copiedRoot, slug: 'source-project' }),
        ).resolves.toEqual({ status: 'absent' });
        await expect(
          afterRestart.check({ root: nestedCopiedRoot, slug: 'nested-project' }),
        ).resolves.toEqual({ status: 'absent' });
      } finally {
        h.dispose();
      }
    });
  },
);

describe.each(implementations)('install-stamp authority contract — %s', (_name, makeHarness) => {
  it('keeps an absent dependency tree claim in memory without creating node_modules or a stamp', async () => {
    const h = makeHarness();
    try {
      await h.vfs.mkdir(ROOT, { recursive: true });
      await h.vfs.writeFile(`${ROOT}/package.json`, PACKAGE_JSON);
      await h.flush?.();
      const a = authority(h);

      await a.demote({ root: ROOT, slug: 'scratch' }, { flush: h.flush });

      expect(await h.vfs.exists(`${ROOT}/node_modules`)).toBe(false);
      expect(await readInstallStamp(h.vfs, ROOT)).toBeNull();
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('pending');
    } finally {
      h.dispose();
    }
  });

  it('owns absent -> pending -> trusted -> absent with one per-claim epoch', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('absent');

      const claim = await a.demote({ root: ROOT, slug: 'scratch' }, { flush: h.flush });
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('pending');
      expect((await readInstallStamp(h.vfs, ROOT))?.epoch).toBe(claim.epoch);

      const promoted = await a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1, flush: h.flush },
      );
      expect(promoted.status).toBe('trusted');
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('trusted');

      await a.revoke({ root: ROOT }, { flush: h.flush });
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('absent');
    } finally {
      h.dispose();
    }
  });

  it('does not trust a marker copied from a different project root', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const claim = await a.demote({ root: ROOT, slug: 'scratch' }, { flush: h.flush });
      await a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1, flush: h.flush },
      );
      await h.vfs.mkdir(`${COPIED_ROOT}/node_modules/vite`, { recursive: true });
      await h.vfs.writeFile(`${COPIED_ROOT}/package.json`, PACKAGE_JSON);
      await h.vfs.writeFile(`${COPIED_ROOT}/node_modules/vite/package.json`, '{}\n');
      await h.vfs.writeFile(
        installStampPath(COPIED_ROOT),
        await h.vfs.readFile(installStampPath(ROOT)),
      );
      await h.flush?.();

      expect((await a.check({ root: COPIED_ROOT, slug: 'scratch' })).status).not.toBe('trusted');
    } finally {
      h.dispose();
    }
  });

  it('materializes a pending fence when demoting a previously trusted tree', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const first = await a.demote({ root: ROOT, slug: 'scratch' }, { flush: h.flush });
      await a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: first.epoch, packages: 1, flush: h.flush },
      );

      const second = await a.demote({ root: ROOT, slug: 'scratch' }, { flush: h.flush });

      expect(await h.vfs.exists(`${ROOT}/node_modules`)).toBe(true);
      expect(await readInstallStamp(h.vfs, ROOT)).toMatchObject({
        durability: 'pending',
        epoch: second.epoch,
      });
    } finally {
      h.dispose();
    }
  });

  it('binds an epoch to its demoted slug; it cannot be reused to re-key trust', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const claim = await a.demote({ root: ROOT, slug: 'scratch' });

      expect(
        await a.promote(
          { root: ROOT, slug: 'project-1', packageJsonText: PACKAGE_JSON },
          { epoch: claim.epoch, packages: 1, flush: h.flush },
        ),
      ).toMatchObject({ status: 'refused', reason: 'claim-replaced' });
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('pending');
      expect((await a.check({ root: ROOT, slug: 'project-1' })).status).toBe('absent');
    } finally {
      h.dispose();
    }
  });

  it('a restarted authority reads a durably pending death point as pending, never trusted', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const first = authority(h);
      await first.demote({ root: ROOT, slug: 'scratch' });
      await h.flush?.();

      const restarted = authority(h);
      expect((await restarted.check({ root: ROOT, slug: 'scratch' })).status).toBe('pending');
      expect((await restarted.check({ root: ROOT, slug: 'other' })).status).toBe('absent');
    } finally {
      h.dispose();
    }
  });

  it('does not park a newer demote behind an older promoter drain; the stale epoch loses', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const first = await a.demote({ root: ROOT, slug: 'scratch' });
      let release!: (report: PersistFailureReport) => void;
      let flushStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        flushStarted = resolve;
      });
      const oldPromotion = a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        {
          epoch: first.epoch,
          packages: 1,
          flush: () => {
            flushStarted();
            return new Promise<PersistFailureReport>((resolve) => {
              release = resolve;
            });
          },
        },
      );
      await started;

      const second = await a.demote({ root: ROOT, slug: 'scratch' });
      expect(second.epoch).not.toBe(first.epoch);
      release({ failures: [], total: 0 });

      expect((await oldPromotion).status).toBe('stale');
      expect((await readInstallStamp(h.vfs, ROOT))?.epoch).toBe(second.epoch);
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('pending');
    } finally {
      h.dispose();
    }
  });

  it('treats normalized root aliases as one claim epoch domain', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const first = await a.demote({ root: `${ROOT}/.`, slug: 'scratch' });
      const second = await a.demote({ root: ROOT, slug: 'scratch' });

      expect(first.root).toBe(ROOT);
      expect(
        await a.promote(
          { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
          { epoch: first.epoch, packages: 1, flush: h.flush },
        ),
      ).toMatchObject({ status: 'stale' });
      expect(
        await a.promote(
          { root: `${ROOT}/.`, slug: 'scratch', packageJsonText: PACKAGE_JSON },
          { epoch: second.epoch, packages: 1, flush: h.flush },
        ),
      ).toMatchObject({ status: 'trusted' });
    } finally {
      h.dispose();
    }
  });

  it('uses the FULL ledger for guarded tree and claim durability', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const claim = await a.demote({ root: ROOT, slug: 'scratch' });
      const hiddenDamage = `${ROOT}/node_modules/vite/package.json`;
      const result = await a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        {
          epoch: claim.epoch,
          packages: 1,
          flush: async () => ({
            failures: [
              { path: '/foreign/cache.json', op: 'write' as const, message: 'QuotaExceededError' },
            ],
            total: 21,
            anyFailure: (predicate) => predicate('/foreign/cache.json') || predicate(hiddenDamage),
          }),
        },
      );

      expect(result).toMatchObject({ status: 'refused', reason: 'guarded-scope-not-durable' });
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).not.toBe('trusted');
    } finally {
      h.dispose();
    }
  });

  it('refuses a claim-file failure beyond the report sample', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const claim = await a.demote({ root: ROOT, slug: 'scratch' });
      const result = await a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        {
          epoch: claim.epoch,
          packages: 1,
          flush: async () => ({
            failures: [
              { path: '/foreign/cache.json', op: 'write' as const, message: 'QuotaExceededError' },
            ],
            total: 21,
            anyFailure: (predicate) =>
              predicate('/foreign/cache.json') || predicate(installStampPath(ROOT)),
          }),
        },
      );

      expect(result).toMatchObject({ status: 'refused', reason: 'claim-not-durable' });
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('pending');
    } finally {
      h.dispose();
    }
  });

  it('compares package identity byte-for-byte, including overrides and section placement', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const claim = await a.demote({ root: ROOT, slug: 'scratch' });
      const moved = `${JSON.stringify({
        name: 'app',
        devDependencies: { vite: '^5.4.0' },
        overrides: { vite: '5.4.22' },
      })}\n`;
      await h.vfs.writeFile(`${ROOT}/package.json`, moved);

      const result = await a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1, flush: h.flush },
      );
      expect(result).toMatchObject({ status: 'refused', reason: 'identity-drift' });
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('pending');
    } finally {
      h.dispose();
    }
  });

  it('restores the trusted mirror and aborts when neither demote nor rm is durably proven', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const initial = await a.demote({ root: ROOT, slug: 'scratch' });
      expect(
        await a.promote(
          { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
          { epoch: initial.epoch, packages: 1 },
        ),
      ).toMatchObject({ status: 'trusted' });

      let calls = 0;
      await expect(
        a.demote(
          { root: ROOT, slug: 'scratch' },
          {
            flush: async () => {
              calls += 1;
              return {
                failures: [
                  {
                    path: installStampPath(ROOT),
                    op: calls === 1 ? ('write' as const) : ('rm' as const),
                    message: 'QuotaExceededError',
                  },
                ],
                total: 1,
              };
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'INSTALL_STAMP_DEMOTE_UNPROVEN' });

      expect(calls).toBe(2);
      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('trusted');
      expect((await readInstallStamp(h.vfs, ROOT))?.durability).toBeUndefined();
    } finally {
      h.dispose();
    }
  });

  it('restores trusted state when revoke cannot be proven durable', async () => {
    const h = makeHarness();
    try {
      await seed(h);
      const a = authority(h);
      const initial = await a.demote({ root: ROOT, slug: 'scratch' });
      expect(
        await a.promote(
          { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
          { epoch: initial.epoch, packages: 1 },
        ),
      ).toMatchObject({ status: 'trusted' });

      await expect(
        a.revoke(
          { root: ROOT },
          {
            flush: async () => ({
              failures: [
                {
                  path: installStampPath(ROOT),
                  op: 'rm' as const,
                  message: 'QuotaExceededError',
                },
              ],
              total: 1,
            }),
          },
        ),
      ).rejects.toMatchObject({ code: 'INSTALL_STAMP_REVOKE_UNPROVEN' });

      expect((await a.check({ root: ROOT, slug: 'scratch' })).status).toBe('trusted');
      expect((await readInstallStamp(h.vfs, ROOT))?.durability).toBeUndefined();
    } finally {
      h.dispose();
    }
  });
});

describe('install-stamp authority async fencing', () => {
  it('falls back to a durably proven removal when the pending-claim write throws', async () => {
    const inner = new MemoryVfs();
    await seed({ vfs: inner, dispose: () => {} });
    let rejectPendingWrite = false;
    let removals = 0;
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'writeFile') {
          return async (path: string, data: Uint8Array | string): Promise<void> => {
            if (rejectPendingWrite && path === installStampPath(ROOT)) {
              rejectPendingWrite = false;
              throw new Error('pending claim write rejected');
            }
            await target.writeFile(path, data);
          };
        }
        if (property === 'rm') {
          return async (path: string, options?: { recursive?: boolean; force?: boolean }) => {
            if (path === installStampPath(ROOT)) removals += 1;
            return target.rm(path, options);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
    const a = createInstallStampAuthority({ vfs });
    const initial = await a.demote({ root: ROOT, slug: 'scratch' });
    await expect(
      a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: initial.epoch, packages: 1 },
      ),
    ).resolves.toMatchObject({ status: 'trusted' });
    rejectPendingWrite = true;
    let flushes = 0;

    await expect(
      a.demote(
        { root: ROOT, slug: 'scratch' },
        {
          flush: async () => {
            flushes += 1;
            return { failures: [], total: 0 };
          },
        },
      ),
    ).resolves.toMatchObject({ root: ROOT, slug: 'scratch' });

    expect(removals).toBe(1);
    expect(flushes).toBe(1);
    await expect(a.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'pending',
    });
    await expect(readInstallStamp(inner, ROOT)).resolves.toBeNull();
  });

  it('restores prior trust when a rejected pending write cannot fall back to durable removal', async () => {
    const inner = new MemoryVfs();
    await seed({ vfs: inner, dispose: () => {} });
    let rejectPendingWrite = false;
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'writeFile') {
          return async (path: string, data: Uint8Array | string): Promise<void> => {
            if (rejectPendingWrite && path === installStampPath(ROOT)) {
              rejectPendingWrite = false;
              throw new Error('pending claim write rejected');
            }
            await target.writeFile(path, data);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
    const a = createInstallStampAuthority({ vfs });
    const initial = await a.demote({ root: ROOT, slug: 'scratch' });
    await expect(
      a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: initial.epoch, packages: 1 },
      ),
    ).resolves.toMatchObject({ status: 'trusted' });
    rejectPendingWrite = true;

    await expect(
      a.demote(
        { root: ROOT, slug: 'scratch' },
        {
          flush: async () => ({
            failures: [
              {
                path: installStampPath(ROOT),
                op: 'rm' as const,
                message: 'QuotaExceededError',
              },
            ],
            total: 1,
          }),
        },
      ),
    ).rejects.toMatchObject({ code: 'INSTALL_STAMP_DEMOTE_UNPROVEN' });

    await expect(a.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'trusted',
    });
    expect((await readInstallStamp(inner, ROOT))?.durability).toBeUndefined();
  });

  it('prepares only the exact current claim for tree mutation and keeps restart state untrusted', async () => {
    const vfs = new MemoryVfs();
    await seed({ vfs, dispose: () => {} });
    const a = createInstallStampAuthority({ vfs });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });

    await expect(a.prepareTreeMutation(claim)).resolves.toBeUndefined();
    await expect(readInstallStamp(vfs, ROOT)).resolves.toBeNull();
    await expect(a.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'pending',
    });
    const restarted = createInstallStampAuthority({ vfs });
    await expect(restarted.check({ root: ROOT, slug: 'scratch' })).resolves.toEqual({
      status: 'absent',
    });
    await expect(vfs.exists(`${ROOT}/node_modules/vite/package.json`)).resolves.toBe(true);
  });

  it('rejects stale and wrong-root tree-mutation claims without changing either tree', async () => {
    const vfs = new MemoryVfs();
    await seed({ vfs, dispose: () => {} });
    await vfs.mkdir(`${COPIED_ROOT}/node_modules/pkg`, { recursive: true });
    await vfs.writeFile(`${COPIED_ROOT}/package.json`, PACKAGE_JSON);
    const a = createInstallStampAuthority({ vfs });
    const stale = await a.demote({ root: ROOT, slug: 'scratch' });
    const current = await a.demote({ root: ROOT, slug: 'scratch' });
    const before = await vfs.readFile(installStampPath(ROOT));

    await expect(a.prepareTreeMutation(stale)).rejects.toMatchObject({
      code: 'INSTALL_STAMP_MUTATION_CLAIM_STALE',
    });
    await expect(a.prepareTreeMutation({ ...current, root: COPIED_ROOT })).rejects.toMatchObject({
      code: 'INSTALL_STAMP_MUTATION_CLAIM_STALE',
    });
    await expect(vfs.readFile(installStampPath(ROOT))).resolves.toEqual(before);
    await expect(vfs.exists(`${ROOT}/node_modules/vite/package.json`)).resolves.toBe(true);
    await expect(vfs.exists(`${COPIED_ROOT}/node_modules/pkg`)).resolves.toBe(true);
  });

  it('does not roll an older failed revoke back over a newer revoke intent', async () => {
    const inner = new MemoryVfs();
    await seed({ vfs: inner, dispose: () => {} });
    let stampWrites = 0;
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'writeFile') {
          return async (path: string, data: Uint8Array | string): Promise<void> => {
            if (path === installStampPath(ROOT)) stampWrites += 1;
            await target.writeFile(path, data);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
    const a = createInstallStampAuthority({ vfs });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });
    await expect(
      a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1 },
      ),
    ).resolves.toMatchObject({ status: 'trusted' });
    expect(stampWrites).toBe(2);

    let firstFlushEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      firstFlushEntered = resolve;
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const older = a.revoke(
      { root: ROOT },
      {
        flush: async () => {
          firstFlushEntered();
          await firstGate;
          return {
            failures: [
              {
                path: installStampPath(ROOT),
                op: 'rm' as const,
                message: 'QuotaExceededError',
              },
            ],
            total: 1,
          };
        },
      },
    );
    await firstEntered;

    let secondFlushEntered!: () => void;
    const secondEntered = new Promise<void>((resolve) => {
      secondFlushEntered = resolve;
    });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const newer = a.revoke(
      { root: ROOT },
      {
        flush: async () => {
          secondFlushEntered();
          await secondGate;
          return { failures: [], total: 0 };
        },
      },
    );
    releaseFirst();

    await expect(older).rejects.toMatchObject({ code: 'INSTALL_STAMP_REVOKE_UNPROVEN' });
    await secondEntered;
    expect(stampWrites).toBe(2);
    await expect(a.check({ root: ROOT, slug: 'scratch' })).resolves.toEqual({
      status: 'absent',
    });

    releaseSecond();
    await expect(newer).resolves.toBeUndefined();
    await expect(readInstallStamp(inner, ROOT)).resolves.toBeNull();
  });

  it('never drains an active trusted claim even when post-write cleanup would double-fail', async () => {
    const inner = new MemoryVfs();
    await seed({ vfs: inner, dispose: () => {} });
    let stampWrites = 0;
    let stampRemovals = 0;
    let rejectCleanup = false;
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'writeFile') {
          return async (path: string, data: Uint8Array | string): Promise<void> => {
            if (path === installStampPath(ROOT)) {
              stampWrites += 1;
              if (rejectCleanup && stampWrites === 3) {
                throw new Error('pending fence write rejected');
              }
            }
            await target.writeFile(path, data);
          };
        }
        if (property === 'rm') {
          return async (path: string, options?: { recursive?: boolean; force?: boolean }) => {
            if (rejectCleanup && path === installStampPath(ROOT)) {
              stampRemovals += 1;
              throw new Error('trusted stamp rm rejected');
            }
            return target.rm(path, options);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
    const a = createInstallStampAuthority({ vfs });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });
    let flushCalls = 0;
    rejectCleanup = true;

    const outcome = await a
      .promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        {
          epoch: claim.epoch,
          packages: 1,
          flush: async () => {
            flushCalls += 1;
            const active = await readInstallStamp(inner, ROOT);
            return active?.durability !== 'pending'
              ? {
                  failures: [
                    {
                      path: `${ROOT}/node_modules/vite/index.js`,
                      op: 'write' as const,
                      message: 'QuotaExceededError',
                    },
                  ],
                  total: 1,
                }
              : { failures: [], total: 0 };
          },
        },
      )
      .then(
        (result) => result,
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );
    const restarted = createInstallStampAuthority({ vfs: inner });

    expect(outcome).toMatchObject({
      status: 'trusted',
    });
    await expect(restarted.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'trusted',
      stamp: { packageJsonText: PACKAGE_JSON },
    });
    expect(flushCalls).toBe(1);
    expect(stampWrites).toBe(2);
    expect(stampRemovals).toBe(0);
  });

  it('keeps the async active claim pending when guarded proof fails', async () => {
    const inner = new MemoryVfs();
    await seed({ vfs: inner, dispose: () => {} });
    let rejectRemoval = false;
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'rm') {
          return async (path: string, options?: { recursive?: boolean; force?: boolean }) => {
            if (rejectRemoval && path === installStampPath(ROOT)) {
              throw new Error('async stamp rm rejected');
            }
            return target.rm(path, options);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
    const a = createInstallStampAuthority({ vfs });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });
    let flushCalls = 0;
    rejectRemoval = true;

    await expect(
      a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        {
          epoch: claim.epoch,
          packages: 1,
          flush: async () => {
            flushCalls += 1;
            return flushCalls === 1
              ? {
                  failures: [
                    {
                      path: `${ROOT}/node_modules/vite/index.js`,
                      op: 'write' as const,
                      message: 'QuotaExceededError',
                    },
                  ],
                  total: 1,
                }
              : { failures: [], total: 0 };
          },
        },
      ),
    ).resolves.toMatchObject({ status: 'refused', reason: 'guarded-scope-not-durable' });
    await expect(readInstallStamp(inner, ROOT)).resolves.toMatchObject({ durability: 'pending' });
    await expect(a.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('keeps the sync active claim pending when guarded proof fails', async () => {
    const pair = createMemoryFs();
    await seed({ vfs: pair.vfs, fsSync: pair.fsSync, dispose: () => {} });
    let rejectRemoval = false;
    const fsSync = new Proxy(pair.fsSync, {
      get(target, property, receiver) {
        if (property === 'rmSync') {
          return (path: string, options?: { recursive?: boolean; force?: boolean }): void => {
            if (rejectRemoval && path === installStampPath(ROOT)) {
              throw new Error('sync stamp rm rejected');
            }
            target.rmSync(path, options ?? {});
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as FsSync;
    const a = createInstallStampAuthority({ vfs: pair.vfs, fsSync });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });
    let flushCalls = 0;
    rejectRemoval = true;

    await expect(
      a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        {
          epoch: claim.epoch,
          packages: 1,
          flush: async () => {
            flushCalls += 1;
            return flushCalls === 1
              ? {
                  failures: [
                    {
                      path: `${ROOT}/node_modules/vite/index.js`,
                      op: 'write' as const,
                      message: 'QuotaExceededError',
                    },
                  ],
                  total: 1,
                }
              : { failures: [], total: 0 };
          },
        },
      ),
    ).resolves.toMatchObject({ status: 'refused', reason: 'guarded-scope-not-durable' });
    await expect(readInstallStamp(pair.vfs, ROOT)).resolves.toMatchObject({
      durability: 'pending',
    });
    expect(a.checkSync({ root: ROOT, slug: 'scratch' })).toMatchObject({ status: 'pending' });
  });

  it('keeps pending without rollback when the pre-commit proof throws', async () => {
    const vfs = new MemoryVfs();
    const h: AuthorityHarness = { vfs, dispose: () => {} };
    await seed(h);
    const a = createInstallStampAuthority({ vfs });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });
    const flushFailure = new Error('OPFS pre-commit proof failed');
    let calls = 0;

    const result = await a.promote(
      { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
      {
        epoch: claim.epoch,
        packages: 1,
        flush: async () => {
          calls += 1;
          if (calls === 1) throw flushFailure;
          return { failures: [], total: 0 };
        },
      },
    );

    expect(result).toMatchObject({
      status: 'refused',
      reason: 'flush-failed',
      error: flushFailure.message,
    });
    expect(calls).toBe(1);
    await expect(readInstallStamp(vfs, ROOT)).resolves.toMatchObject({ durability: 'pending' });
    await expect(a.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('keeps pending when the final proof reports the claim file unproven', async () => {
    const vfs = new MemoryVfs();
    const h: AuthorityHarness = { vfs, dispose: () => {} };
    await seed(h);
    const a = createInstallStampAuthority({ vfs });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });
    let calls = 0;

    const result = await a.promote(
      { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
      {
        epoch: claim.epoch,
        packages: 1,
        flush: async () => {
          calls += 1;
          return calls === 1
            ? {
                failures: [
                  {
                    path: installStampPath(ROOT),
                    op: 'write' as const,
                    message: 'QuotaExceededError',
                  },
                ],
                total: 1,
              }
            : { failures: [], total: 0 };
        },
      },
    );

    expect(result).toMatchObject({
      status: 'refused',
      reason: 'claim-not-durable',
    });
    expect(calls).toBe(1);
    await expect(a.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('a commit-marker rejection before mutation leaves a reload-visible pending claim', async () => {
    const inner = new MemoryVfs();
    await seed({ vfs: inner, dispose: () => {} });
    let stampWrites = 0;
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'writeFile') {
          return async (path: string, data: Uint8Array | string): Promise<void> => {
            if (path === installStampPath(ROOT) && ++stampWrites === 2) {
              throw new Error('write rejected before mutation');
            }
            await target.writeFile(path, data);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
    const a = createInstallStampAuthority({ vfs });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });

    await expect(
      a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1 },
      ),
    ).resolves.toMatchObject({ status: 'refused', reason: 'write-failed' });
    await expect(readInstallStamp(inner, ROOT)).resolves.toMatchObject({ durability: 'pending' });
    const restarted = createInstallStampAuthority({ vfs: inner });
    await expect(restarted.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('a commit-marker rejection after mutation leaves only a truthful trusted claim', async () => {
    const inner = new MemoryVfs();
    const h: AuthorityHarness = { vfs: inner, dispose: () => {} };
    await seed(h);
    let stampWrites = 0;
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'writeFile') {
          return async (path: string, data: Uint8Array | string): Promise<void> => {
            await target.writeFile(path, data);
            if (path === installStampPath(ROOT) && ++stampWrites === 2) {
              throw new Error('write rejected after mutation');
            }
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
    const a = createInstallStampAuthority({ vfs });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });

    await expect(
      a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1 },
      ),
    ).resolves.toMatchObject({ status: 'refused', reason: 'write-failed' });
    await expect(a.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'pending',
    });
    const restarted = createInstallStampAuthority({ vfs: inner });
    await expect(restarted.check({ root: ROOT, slug: 'scratch' })).resolves.toMatchObject({
      status: 'trusted',
      stamp: { packageJsonText: PACKAGE_JSON },
    });
  });

  it('a sync commit-marker rejection after mutation leaves only a truthful trusted claim', async () => {
    const pair = createMemoryFs();
    await seed({ vfs: pair.vfs, fsSync: pair.fsSync, dispose: () => {} });
    let stampWrites = 0;
    const fsSync = new Proxy(pair.fsSync, {
      get(target, property, receiver) {
        if (property === 'writeFileSync') {
          return (path: string, data: Uint8Array): void => {
            target.writeFileSync(path, data);
            if (path === installStampPath(ROOT) && ++stampWrites === 2) {
              throw new Error('sync write rejected after mutation');
            }
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as FsSync;
    const a = createInstallStampAuthority({ vfs: pair.vfs, fsSync });
    const claim = await a.demote({ root: ROOT, slug: 'scratch' });

    await expect(
      a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: claim.epoch, packages: 1 },
      ),
    ).resolves.toMatchObject({ status: 'refused', reason: 'write-failed' });
    expect(a.checkSync({ root: ROOT, slug: 'scratch' })).toMatchObject({ status: 'pending' });
    const restarted = createInstallStampAuthority({ vfs: pair.vfs, fsSync: pair.fsSync });
    expect(restarted.checkSync({ root: ROOT, slug: 'scratch' })).toMatchObject({
      status: 'trusted',
      stamp: { packageJsonText: PACKAGE_JSON },
    });
  });

  it('a newer demote fences a promoter parked in its final identity probe', async () => {
    const inner = new MemoryVfs();
    let armed = false;
    let finalProbeParked!: () => void;
    const parked = new Promise<void>((resolve) => {
      finalProbeParked = resolve;
    });
    let releaseProbe!: () => void;
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'readFileText') {
          return async (path: string): Promise<string> => {
            const text = await target.readFileText(path);
            if (armed && path === `${ROOT}/package.json`) {
              armed = false;
              finalProbeParked();
              await probeGate;
            }
            return text;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
    await seed({ vfs: inner, dispose: () => {} });
    const a = createInstallStampAuthority({ vfs });
    const first = await a.demote({ root: ROOT, slug: 'scratch' });
    armed = true;
    const oldPromotion = a.promote(
      { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
      {
        epoch: first.epoch,
        packages: 1,
        flush: async () => ({ failures: [], total: 0 }),
      },
    );
    await parked;

    const newerDemotion = a.demote({ root: ROOT, slug: 'scratch' });
    releaseProbe();

    await expect(oldPromotion).resolves.toEqual({ status: 'stale' });
    const newer = await newerDemotion;
    await expect(readInstallStamp(inner, ROOT)).resolves.toMatchObject({
      durability: 'pending',
      epoch: newer.epoch,
    });
  });

  it('a check that read trusted before a concurrent demote returns pending, never stale trust', async () => {
    const inner = new MemoryVfs();
    let armed = false;
    let readParked!: () => void;
    const parked = new Promise<void>((resolve) => {
      readParked = resolve;
    });
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const vfs = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'readFileText') {
          return async (path: string): Promise<string> => {
            const text = await target.readFileText(path);
            if (armed && path === installStampPath(ROOT)) {
              armed = false;
              readParked();
              await readGate;
            }
            return text;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as unknown as Vfs;
    const h: AuthorityHarness = { vfs: inner, dispose: () => {} };
    await seed(h);
    const a = createInstallStampAuthority({ vfs });
    const initial = await a.demote({ root: ROOT, slug: 'scratch' });
    expect(
      await a.promote(
        { root: ROOT, slug: 'scratch', packageJsonText: PACKAGE_JSON },
        { epoch: initial.epoch, packages: 1 },
      ),
    ).toMatchObject({ status: 'trusted' });

    armed = true;
    const checking = a.check({ root: ROOT, slug: 'scratch' });
    await parked;
    await a.demote({ root: ROOT, slug: 'scratch' });
    releaseRead();

    expect((await checking).status).toBe('pending');
  });
});
