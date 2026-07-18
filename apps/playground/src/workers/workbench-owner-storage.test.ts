import {
  RegistryClient,
  type ShadowAssetStorage,
  type ShadowAssetStorageClass,
  TARBALL_CACHE_ROOT,
  VfsTarballCache,
  createShadowAssetManager,
  createStandardShadowAssetSource,
} from '@riftydev/npm-client';
import { MemoryVfs, OpfsFsSync, type PersistFailureReport } from '@riftydev/vfs';
import { createMemoryFs, setSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  type OwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import {
  type WorkbenchOwnerStorageCompositionDependencies,
  createWorkbenchOwnerStorageComposition,
} from './workbench-owner-storage-composition.ts';
import * as ownerStorageRuntime from './workbench-owner-storage.ts';
import {
  type WorkbenchOwnerStorageInstallers,
  createWorkbenchRuntimeAssetStorage,
  installWorkbenchOwnerStorage,
  workbenchFinalDurabilityError,
  workbenchRuntimeAssetStorageClass,
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
  it('orders storage install, retention proof, sole authority, and asset adapter', async () => {
    const pair = createMemoryFs();
    const events: string[] = [];
    const dependencies: WorkbenchOwnerStorageCompositionDependencies = {
      async installStorage() {
        events.push('storage');
        return { policy: 'required', backend: 'opfs', durability: 'durable' };
      },
      async probeRetention() {
        events.push('retention');
        return { available: true, persistedAfter: false };
      },
      createOwner() {
        events.push('authority');
        return createOwnerVfsAuthorityComposition(pair.fsSync, {
          ownerEpoch: 'storage-composition-order',
          initialRoots: ['/', '/.rifty'],
        });
      },
      attachAsyncMirror(authority) {
        events.push('mirror');
        setSyncMirror(authority, { async: pair.vfs });
      },
      createRuntimeAssets(authority, storageClass) {
        events.push(`adapter:${storageClass}`);
        return createWorkbenchRuntimeAssetStorage(authority, storageClass);
      },
    };

    const composition = await createWorkbenchOwnerStorageComposition('required', dependencies);

    expect(events).toEqual([
      'storage',
      'retention',
      'authority',
      'mirror',
      'adapter:opfs-best-effort',
    ]);
    await composition.runtimeAssets.close();
  });

  it('reports retention from actual backend plus confirmed persistedAfter only', () => {
    const durable = {
      policy: 'required' as const,
      backend: 'opfs' as const,
      durability: 'durable' as const,
    };
    expect(
      workbenchRuntimeAssetStorageClass(durable, {
        available: true,
        persistedAfter: true,
      }),
    ).toBe('opfs-persisted');
    expect(
      workbenchRuntimeAssetStorageClass(durable, {
        available: true,
        persistedAfter: false,
      }),
    ).toBe('opfs-best-effort');
    expect(workbenchRuntimeAssetStorageClass(durable, { available: false })).toBe(
      'opfs-best-effort',
    );
    expect(
      workbenchRuntimeAssetStorageClass(
        { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
        { available: true, persistedAfter: true },
      ),
    ).toBe('memory-session');
  });

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
    composition.authority.mkdirSync(TARBALL_CACHE_ROOT, { recursive: true });
    composition.authority.writeFileSync(`${TARBALL_CACHE_ROOT}/retained.tgz`, new Uint8Array([9]));

    await expect(manager.admin.clearCache()).resolves.toEqual({
      storageClass: 'memory-session',
      entryCount: 0,
      storedBytes: 0,
      verifiedObjectCount: 0,
      verifiedObjectBytes: 0,
      readySetCount: 0,
    });
    expect(composition.authority.existsSync(`${TARBALL_CACHE_ROOT}/retained.tgz`)).toBe(true);
    await manager.close();
  });

  it('retries a physical runtime-asset tombstone after persisted rm recovers', async () => {
    const supported = vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true);
    let rejectRuntimeAssetRemove = false;
    const root = {} as FileSystemDirectoryHandle;
    Object.assign(root, {
      kind: 'directory',
      name: '',
      isSameEntry: () => Promise.resolve(false),
      getDirectoryHandle: () => Promise.resolve(root),
      getFileHandle: () => Promise.reject(new Error('unused file handle')),
      removeEntry: () =>
        rejectRuntimeAssetRemove
          ? Promise.reject(new Error('runtime asset remove denied'))
          : Promise.resolve(),
      resolve: () => Promise.resolve([]),
      entries: async function* () {},
    });
    const surface = {
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: () => Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const fsSync = new OpfsFsSync(root, surface);
    const composition = createOwnerVfsAuthorityComposition(fsSync, {
      ownerEpoch: 'runtime-assets-clear-retry-owner',
      initialRoots: ['/', '/.rifty'],
    });
    const storage = createWorkbenchRuntimeAssetStorage(composition.authority, 'opfs-best-effort');
    const manager = createShadowAssetManager({
      storage,
      source: createStandardShadowAssetSource({
        registry: new RegistryClient({
          baseUrl: 'https://registry.invalid',
          fetch: async () => new Response(null, { status: 404 }),
        }),
        tarballCache: new VfsTarballCache(new MemoryVfs()),
      }),
    });
    try {
      await storage.write({ kind: 'temp', id: 'clear-retry' }, new Uint8Array([1]));
      rejectRuntimeAssetRemove = true;
      await expect(manager.admin.clearCache()).rejects.toThrow();
      expect(
        composition.authority.statSyncOrNull('/.rifty/workbench/v1/runtime-assets/v1'),
      ).toBeNull();

      rejectRuntimeAssetRemove = false;
      await expect(manager.admin.clearCache()).resolves.toEqual({
        storageClass: 'opfs-best-effort',
        entryCount: 0,
        storedBytes: 0,
        verifiedObjectCount: 0,
        verifiedObjectBytes: 0,
        readySetCount: 0,
      });
      await expect(composition.authority.flush()).resolves.toMatchObject({ total: 0 });
    } finally {
      await manager.close();
      supported.mockRestore();
    }
  });

  it('keeps traversal-shaped temp ids inside the semantic temp directory', async () => {
    const { fsSync } = createMemoryFs();
    const composition = createOwnerVfsAuthorityComposition(fsSync, {
      ownerEpoch: 'runtime-assets-temp-path-owner',
      initialRoots: ['/', '/.rifty'],
    });
    const storage = createWorkbenchRuntimeAssetStorage(composition.authority, 'memory-session');
    const entry = { kind: 'temp' as const, id: '..' };

    await storage.write(entry, new Uint8Array([7]));

    expect(
      composition.authority.existsSync('/.rifty/workbench/v1/runtime-assets/v1/tmp/%2E%2E'),
    ).toBe(true);
    await expect(storage.read(entry)).resolves.toEqual(new Uint8Array([7]));
    await storage.close();
  });

  it('counts undecodable physical residue without admitting it as a semantic entry', async () => {
    const { fsSync } = createMemoryFs();
    const composition = createOwnerVfsAuthorityComposition(fsSync, {
      ownerEpoch: 'runtime-assets-corrupt-name-owner',
      initialRoots: ['/', '/.rifty'],
    });
    const storage = createWorkbenchRuntimeAssetStorage(composition.authority, 'memory-session');
    const source = createStandardShadowAssetSource({
      registry: new RegistryClient({
        baseUrl: 'https://registry.invalid',
        fetch: async () => new Response(null, { status: 404 }),
      }),
      tarballCache: new VfsTarballCache(new MemoryVfs()),
    });
    const manager = createShadowAssetManager({ storage, source });
    const objectDirectory = '/.rifty/workbench/v1/runtime-assets/v1/objects';
    const tempDirectory = '/.rifty/workbench/v1/runtime-assets/v1/tmp';
    composition.authority.mkdirSync(objectDirectory, { recursive: true });
    composition.authority.mkdirSync(tempDirectory, { recursive: true });
    composition.authority.writeFileSync(`${objectDirectory}/not-a-sha256`, new Uint8Array([1, 2]));
    composition.authority.writeFileSync(`${tempDirectory}/%not-hex`, new Uint8Array([3]));
    composition.authority.mkdirSync(`${objectDirectory}/orphan`, { recursive: true });
    composition.authority.writeFileSync(
      `${objectDirectory}/orphan/nested.bin`,
      new Uint8Array([4, 5, 6, 7]),
    );

    await expect(storage.inspect()).resolves.toEqual({
      entryCount: 3,
      storedBytes: 7,
      entries: [],
    });
    await expect(manager.admin.inspectUsage()).resolves.toEqual({
      storageClass: 'memory-session',
      entryCount: 3,
      storedBytes: 7,
      verifiedObjectCount: 0,
      verifiedObjectBytes: 0,
      readySetCount: 0,
    });
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

  it('sanitizes final asset persistence faults while retaining mixed-scope aggregation', () => {
    const assetPath = '/.rifty/workbench/v1/runtime-assets/v1/objects/private-object';
    const projectPath = '/.rifty/workbench/v1/projects/alpha/tree/index.js';
    const rawDetail = 'permission denied in private OPFS handle';
    const assetOnly = workbenchFinalDurabilityError({
      failures: [{ path: assetPath, op: 'write', message: rawDetail }],
      total: 1,
    });

    expect(assetOnly).toMatchObject({
      name: 'RuntimeAssetError',
      code: 'ESHADOWASSET',
      message: 'Runtime asset manager close failed',
      phase: 'close',
      recovery: 'none',
    });
    expect(JSON.stringify(assetOnly)).not.toContain(assetPath);
    expect(JSON.stringify(assetOnly)).not.toContain(rawDetail);

    const mixed = workbenchFinalDurabilityError({
      failures: [
        { path: assetPath, op: 'write', message: rawDetail },
        { path: projectPath, op: 'write', message: 'project quota detail' },
      ],
      total: 2,
    });
    expect(mixed).toBeInstanceOf(AggregateError);
    if (!(mixed instanceof AggregateError)) throw new Error('expected mixed final aggregation');
    expect(mixed.errors).toHaveLength(2);
    expect(mixed.errors[0]).toMatchObject({ name: 'RuntimeAssetError', phase: 'close' });
    expect(mixed.message).toBe('Workbench owner final durability failed');
    expect(mixed.errors.map((failure) => String(failure)).join('\n')).not.toContain(assetPath);
    expect(mixed.errors.map((failure) => String(failure)).join('\n')).not.toContain(rawDetail);
    expect(mixed.errors.map((failure) => String(failure)).join('\n')).not.toContain(projectPath);
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

  it('acknowledges only asset-scope failures and rejects an ambiguous truncated ledger', async () => {
    const { fsSync } = createMemoryFs();
    const composition = createOwnerVfsAuthorityComposition(fsSync, {
      ownerEpoch: 'runtime-assets-scope-owner',
      initialRoots: ['/', '/.rifty'],
    });
    const storage = createWorkbenchRuntimeAssetStorage(composition.authority, 'opfs-best-effort');
    const projectFailure = {
      path: '/.rifty/workbench/v1/projects/alpha/tree/index.js',
      op: 'write' as const,
      message: 'project quota',
    };
    composition.authority.flush = async () => ({
      failures: [projectFailure],
      total: 1,
      anyFailure: (predicate) => predicate(projectFailure.path),
    });
    await expect(
      storage.write({ kind: 'temp', id: 'project-sibling' }, new Uint8Array([1])),
    ).resolves.toBeUndefined();

    const assetFailure = {
      path: '/.rifty/workbench/v1/runtime-assets/v1/tmp/asset-failure',
      op: 'write' as const,
      message: 'asset quota',
    };
    composition.authority.flush = async () => ({
      failures: [projectFailure],
      total: 2,
      anyFailure: (predicate) => predicate(projectFailure.path) || predicate(assetFailure.path),
    });
    await expect(
      storage.write({ kind: 'temp', id: 'asset-failure' }, new Uint8Array([2])),
    ).rejects.toThrow(/runtime asset persistence/i);

    composition.authority.flush = async () => ({ failures: [projectFailure], total: 2 });
    await expect(
      storage.write({ kind: 'temp', id: 'ambiguous' }, new Uint8Array([3])),
    ).rejects.toThrow(/truncated.*full-ledger/i);
  });
});
