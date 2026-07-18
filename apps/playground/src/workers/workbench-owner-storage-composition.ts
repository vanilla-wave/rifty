import type { ShadowAssetStorage } from '@riftydev/npm-client';
import { syncMirror } from '@riftydev/vfs';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { probeStoragePersistence } from '../glue/storage-status.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import type { OwnerStoragePersistence, OwnerStorageSnapshot } from './owner-storage.ts';
import {
  type OwnerVfsAuthority,
  type OwnerVfsAuthorityComposition,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import {
  type WorkbenchOwnerStorageRetention,
  createWorkbenchRuntimeAssetStorage,
  installWorkbenchOwnerStorage,
  workbenchRuntimeAssetStorageClass,
} from './workbench-owner-storage.ts';

export interface WorkbenchOwnerStorageComposition {
  readonly storage: OwnerStorageSnapshot;
  readonly retention: WorkbenchOwnerStorageRetention;
  readonly owner: OwnerVfsAuthorityComposition;
  readonly runtimeAssets: ShadowAssetStorage;
}

export interface WorkbenchOwnerStorageCompositionDependencies {
  installStorage(persistence: OwnerStoragePersistence): Promise<OwnerStorageSnapshot>;
  probeRetention(): Promise<WorkbenchOwnerStorageRetention>;
  createOwner(): OwnerVfsAuthorityComposition;
  attachAsyncMirror(authority: OwnerVfsAuthority): void;
  createRuntimeAssets(
    authority: OwnerVfsAuthority,
    storageClass: ShadowAssetStorage['storageClass'],
  ): ShadowAssetStorage;
}

function defaultDependencies(): WorkbenchOwnerStorageCompositionDependencies {
  return Object.freeze({
    installStorage: installWorkbenchOwnerStorage,
    probeRetention: probeStoragePersistence,
    createOwner: () =>
      createOwnerVfsAuthorityComposition(syncMirror(), { initialRoots: ['/', '/.rifty'] }),
    attachAsyncMirror: (authority: OwnerVfsAuthority) =>
      setSyncMirror(authority, { async: new SyncMirrorVfs() }),
    createRuntimeAssets: createWorkbenchRuntimeAssetStorage,
  });
}

/** ADR-0249 boot order: install → retention proof → sole authority → adapter. */
export async function createWorkbenchOwnerStorageComposition(
  persistence: OwnerStoragePersistence,
  dependencies: WorkbenchOwnerStorageCompositionDependencies = defaultDependencies(),
): Promise<WorkbenchOwnerStorageComposition> {
  const storage = await dependencies.installStorage(persistence);
  const retention =
    storage.backend === 'opfs'
      ? await dependencies.probeRetention()
      : Object.freeze({ available: false as const });
  const owner = dependencies.createOwner();
  dependencies.attachAsyncMirror(owner.authority);
  const runtimeAssets = dependencies.createRuntimeAssets(
    owner.authority,
    workbenchRuntimeAssetStorageClass(storage, retention),
  );
  return Object.freeze({ storage, retention, owner, runtimeAssets });
}
