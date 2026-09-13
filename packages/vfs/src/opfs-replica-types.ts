import type { PersistOperation } from './opfs-drain-scheduler.ts';

export interface OpfsLayoutIssue {
  readonly kind: 'legacy' | 'corrupt';
  readonly summary: string;
}

interface ReplicaMetadata {
  readonly path: string;
  readonly atime: number;
  readonly mtime: number;
}

export type ReplicaImage =
  | (ReplicaMetadata & { readonly kind: 'dir' })
  | (ReplicaMetadata & { readonly kind: 'file'; readonly bytes: Uint8Array<ArrayBuffer> });

export type ReplicaRecord = ReplicaImage | { readonly kind: 'delete'; readonly path: string };

/** Physical sink only; OpfsFsSync owns the live bytes, ledger and drain. */
export interface ReplicaPersistence {
  readonly layoutIssue?: OpfsLayoutIssue;
  assertWritable(): void;
  commit(
    mutations: readonly PersistOperation[],
    records: readonly ReplicaRecord[],
    capture: () => readonly ReplicaImage[],
  ): Promise<{ readonly base: boolean }>;
  closeAfter(settled: Promise<void>): void;
}
