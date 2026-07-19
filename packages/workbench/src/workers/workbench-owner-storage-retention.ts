import type { WorkbenchOwnerStorageRetention } from './workbench-owner-storage.ts';

export interface WorkbenchOwnerStorageRetentionCapability {
  readonly persisted?: () => Promise<boolean>;
  readonly persist?: () => Promise<boolean>;
}

const UNAVAILABLE_RETENTION = Object.freeze({ available: false as const });

export async function probeWorkbenchOwnerStorageRetention(
  capability: WorkbenchOwnerStorageRetentionCapability | undefined,
): Promise<WorkbenchOwnerStorageRetention> {
  if (capability === undefined) return UNAVAILABLE_RETENTION;

  try {
    const persistedBefore = capability.persisted ? await capability.persisted() : false;
    const persistedAfter =
      persistedBefore || capability.persist === undefined
        ? persistedBefore
        : await capability.persist();
    return Object.freeze({ available: true as const, persistedAfter });
  } catch {
    return UNAVAILABLE_RETENTION;
  }
}
