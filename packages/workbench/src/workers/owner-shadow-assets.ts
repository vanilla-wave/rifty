import type { RegistryClient } from '@riftydev/npm-client';
import {
  type OriginExclusiveShadowAssetManager,
  type ShadowAssetStorageClass,
  type ShadowAssetVfsDurability,
  createMemoryShadowAssetStorage,
  createOriginExclusiveShadowAssetManager,
  createRegistryShadowAssetSource,
  createVfsShadowAssetStorage,
  probeBrowserShadowAssetStorageClass,
} from '@riftydev/npm-client/internal';
import type { Vfs } from '@riftydev/vfs';
import type { OwnerStorageSnapshot } from './owner-storage.ts';

export interface OwnerShadowAssetAuthority {
  readonly manager: OriginExclusiveShadowAssetManager;
  readonly storageClass: ShadowAssetStorageClass;
}

/** Probe the origin honestly before choosing the matching shadow-asset store. */
export async function createOwnerShadowAssetAuthority(
  options: Readonly<{
    ownerStorage: OwnerStorageSnapshot;
    vfs: Vfs;
    registry: RegistryClient;
    storageManager?: Pick<StorageManager, 'persisted' | 'persist'>;
    /** Required when ownerStorage selected OPFS; retained outside clone-safe protocol state. */
    durability?: ShadowAssetVfsDurability;
  }>,
): Promise<OwnerShadowAssetAuthority> {
  const storageClass = await probeBrowserShadowAssetStorageClass(
    options.ownerStorage.backend === 'opfs',
    options.storageManager,
  );
  let storage: ReturnType<typeof createMemoryShadowAssetStorage>;
  if (storageClass === 'memory-session') {
    storage = createMemoryShadowAssetStorage();
  } else {
    if (options.durability === undefined) {
      throw new TypeError('OPFS shadow asset authority requires persisted durability');
    }
    storage = createVfsShadowAssetStorage(options.vfs, storageClass, options.durability);
  }
  return Object.freeze({
    storageClass,
    manager: createOriginExclusiveShadowAssetManager({
      storage,
      source: createRegistryShadowAssetSource(options.registry),
    }),
  });
}
