import {
  RegistryClient,
  VfsTarballCache,
  createShadowAssetManager,
  createStandardShadowAssetSource,
  type ShadowAssetStorage,
  type ShadowAssetStorageClass,
} from '@riftydev/npm-client';
import { MemoryVfs, type PersistFailureReport } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  type OwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import * as ownerStorageRuntime from './workbench-owner-storage.ts';
import {
  type WorkbenchOwnerStorageInstallers,
  installWorkbenchOwnerStorage,
} from './workbench-owner-storage.ts';

type RuntimeAssetStorageFactory = (
  authority: OwnerVfsAuthority,
  storageClass: ShadowAssetStorageClass,
) => ShadowAssetStorage;

function installers(): WorkbenchOwnerStorageInstallers {
  const { vfs, fsSync } = createMemoryFs();
  const opfsSync = Object.assign(fsSync, {
    flush: async (): Promise<PersistFailureReport> => ({ failures: [], total: 0 }),
  });
  return {
    openMemory: vi.fn(() => {}),
    openOpfs: vi.fn(async () => ({ vfs, fsSync: opfsSync })),
  };
}

describe('Workbench owner storage runtime', () => {
  it('backs the real manager with one owner-private semantic store', async () => {
    const createStorage = (
      ownerStorageRuntime as unknown as {
        readonly createWorkbenchRuntimeAssetStorage?: RuntimeAssetStorageFactory;
      }
    ).createWorkbenchRuntimeAssetStorage;
    expect(createStorage).toBeTypeOf('function');
    if (createStorage === undefined) return;

    const { fsSync } = createMemoryFs();
    const composition = createOwnerVfsAuthorityComposition(fsSync, {
      ownerEpoch: 'runtime-assets-contract-owner',
      initialRoots: ['/', '/.rifty'],
    });
    const storage = createStorage(composition.authority, 'memory-session');
    const source = createStandardShadowAssetSource({
      registry: new RegistryClient({
        baseUrl: 'https://registry.invalid',
        fetch: async () => new Response(null, { status: 404 }),
      }),
      tarballCache: new VfsTarballCache(new MemoryVfs()),
    });
    const manager = createShadowAssetManager({ storage, source });

    await storage.write({ kind: 'temp', id: 'contract-residue' }, new Uint8Array([1, 2, 3]));
    await expect(manager.admin.inspectUsage()).resolves.toEqual({
      storageClass: 'memory-session',
      entryCount: 1,
      storedBytes: 3,
      verifiedObjectCount: 0,
      verifiedObjectBytes: 0,
      readySetCount: 0,
    });
    expect(
      composition.authority.existsSync(
        '/.rifty/workbench/v1/runtime-assets/v1/tmp/contract-residue',
      ),
    ).toBe(true);

    await expect(manager.admin.clearCache()).resolves.toEqual({
      storageClass: 'memory-session',
      entryCount: 0,
      storedBytes: 0,
      verifiedObjectCount: 0,
      verifiedObjectBytes: 0,
      readySetCount: 0,
    });
    await manager.close();
  });

  it('ephemeral intentionally installs memory and never opens OPFS', async () => {
    const h = installers();

    await expect(
      installWorkbenchOwnerStorage('ephemeral', { installers: h, proofTimeoutMs: 50 }),
    ).resolves.toEqual({
      policy: 'ephemeral',
      backend: 'memory',
      durability: 'ephemeral',
    });
    expect(h.openMemory).toHaveBeenCalledTimes(1);
    expect(h.openOpfs).not.toHaveBeenCalled();
  });

  it('required proves persisted bytes through the paired async OPFS surface and removes them', async () => {
    const h = installers();
    const opened = await h.openOpfs();
    h.openOpfs = vi.fn(async () => opened);

    await expect(
      installWorkbenchOwnerStorage('required', {
        installers: h,
        proofTimeoutMs: 50,
        createProofId: () => 'proof-1',
      }),
    ).resolves.toEqual({ policy: 'required', backend: 'opfs', durability: 'durable' });

    expect(await opened.vfs.exists('/.rifty/workbench/v1/storage-proof/proof-1')).toBe(false);
    expect(h.openMemory).not.toHaveBeenCalled();
  });

  it('required rejects when the persisted OPFS read diverges from the sync write', async () => {
    const h = installers();
    const opened = await h.openOpfs();
    h.openOpfs = vi.fn(async () => ({
      fsSync: opened.fsSync,
      vfs: { ...opened.vfs, readFile: async () => new Uint8Array([0]) },
    }));

    await expect(
      installWorkbenchOwnerStorage('required', {
        installers: h,
        proofTimeoutMs: 50,
        createProofId: () => 'proof-2',
      }),
    ).rejects.toThrow(/persisted bytes.*mismatch/i);
    expect(h.openMemory).not.toHaveBeenCalled();
  });

  it('preferred falls back visibly when the bounded durability proof hangs', async () => {
    const h = installers();
    const opened = await h.openOpfs();
    h.openOpfs = vi.fn(async () => ({
      fsSync: opened.fsSync,
      vfs: { ...opened.vfs, readFile: () => new Promise<Uint8Array>(() => {}) },
    }));

    const snapshot = await installWorkbenchOwnerStorage('preferred', {
      installers: h,
      proofTimeoutMs: 5,
      createProofId: () => 'proof-3',
    });

    expect(snapshot).toMatchObject({
      policy: 'preferred',
      backend: 'memory',
      durability: 'ephemeral',
      fallback: { reason: expect.stringMatching(/timed out/i) },
    });
    expect(h.openMemory).toHaveBeenCalledTimes(1);
  });
});
