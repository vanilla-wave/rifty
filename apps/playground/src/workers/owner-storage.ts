import { NotImplementedError } from '@riftydev/vfs';

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
  _policy: OwnerStoragePersistence,
  _installers: OwnerStorageInstallers<OpfsBackend>,
): Promise<OwnerStorageSnapshot> {
  throw new NotImplementedError(
    'workbench.selectOwnerStorage',
    'Contract+RED: owner storage selection is not implemented',
  );
}
