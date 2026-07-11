export interface StorageEstimateLike {
  readonly usage?: number;
  readonly quota?: number;
}

export interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<StorageEstimateLike>;
}

export interface StorageNavigatorLike {
  readonly storage?: StorageManagerLike;
}

export type StoragePersistenceStatus =
  | {
      readonly available: false;
      readonly error?: string;
    }
  | {
      readonly available: true;
      readonly persistedBefore: boolean;
      readonly persistedAfter: boolean;
      readonly usage?: number;
      readonly quota?: number;
      readonly error?: string;
    };

function defaultNavigator(): StorageNavigatorLike {
  return globalThis.navigator as StorageNavigatorLike;
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function probeStoragePersistence(
  nav: StorageNavigatorLike = defaultNavigator(),
): Promise<StoragePersistenceStatus> {
  const storage = nav.storage;
  if (!storage) return { available: false };

  try {
    const persistedBefore = storage.persisted ? await storage.persisted() : false;
    const persistedAfter =
      persistedBefore || !storage.persist ? persistedBefore : await storage.persist();
    const estimate = storage.estimate ? await storage.estimate() : {};

    return {
      available: true,
      persistedBefore,
      persistedAfter,
      usage: estimate.usage,
      quota: estimate.quota,
    };
  } catch (err) {
    return { available: false, error: reasonOf(err) };
  }
}
