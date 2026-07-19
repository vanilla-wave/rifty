export type OwnerStoragePersistence = 'required' | 'preferred' | 'ephemeral';

export type OwnerStorageSnapshot =
  | {
      readonly policy: 'required';
      readonly backend: 'opfs';
      readonly durability: 'durable';
    }
  | {
      readonly policy: 'preferred';
      readonly backend: 'opfs';
      readonly durability: 'durable';
    }
  | {
      readonly policy: 'preferred';
      readonly backend: 'memory';
      readonly durability: 'ephemeral';
      readonly fallback: { readonly reason: string };
    }
  | {
      readonly policy: 'ephemeral';
      readonly backend: 'memory';
      readonly durability: 'ephemeral';
    };

/** Browser/VFS effects injected at the owner-realm composition boundary. */
export interface OwnerStorageInstallers<OpfsBackend> {
  openOpfs(): Promise<OpfsBackend>;
  proveOpfs(backend: OpfsBackend): Promise<void>;
  openMemory(): void | Promise<void>;
}

/** Owner-authoritative storage selection; page code never predicts this result. */
export async function selectOwnerStorage<OpfsBackend>(
  policy: OwnerStoragePersistence,
  installers: OwnerStorageInstallers<OpfsBackend>,
): Promise<OwnerStorageSnapshot> {
  if (policy === 'ephemeral') {
    await installers.openMemory();
    return Object.freeze({
      policy: 'ephemeral',
      backend: 'memory',
      durability: 'ephemeral',
    });
  }

  let opfsFailure: unknown;
  try {
    const backend = await installers.openOpfs();
    await installers.proveOpfs(backend);
    return Object.freeze({ policy, backend: 'opfs', durability: 'durable' });
  } catch (error) {
    if (policy === 'required') throw error;
    opfsFailure = error;
  }

  try {
    await installers.openMemory();
  } catch (memoryFailure) {
    throw new AggregateError(
      [opfsFailure, memoryFailure],
      `Preferred storage failed: ${failureMessage(opfsFailure)}; ${failureMessage(memoryFailure)}`,
    );
  }

  const fallback = Object.freeze({ reason: failureMessage(opfsFailure) });
  return Object.freeze({
    policy: 'preferred',
    backend: 'memory',
    durability: 'ephemeral',
    fallback,
  });
}

function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
