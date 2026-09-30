export type SandboxErrorKind =
  | 'busy'
  | 'resident-busy'
  | 'occupied'
  | 'snapshot-conflict'
  | 'snapshot-mismatch'
  | 'restart-busy'
  | 'persistence';

/** Structural receipts survive Worker serialization and duplicate SDK packages. */
export function sandboxErrorKind(error: unknown): SandboxErrorKind | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const value = error as { name?: unknown; code?: unknown; feature?: unknown };
  if (value.code === 'ERR_STORAGE_OCCUPIED') return 'occupied';
  switch (value.name) {
    case 'SandboxToolchainBusyError':
      return 'busy';
    case 'SandboxResidentToolBusyError':
      return 'resident-busy';
    case 'SnapshotApplicationConflictError':
      return 'snapshot-conflict';
    case 'SandboxSnapshotMismatchError':
      return 'snapshot-mismatch';
    case 'SandboxRestartBusyError':
      return 'restart-busy';
    case 'SandboxPersistenceError':
      return 'persistence';
    case 'NotImplementedError':
      if (value.feature === 'sandbox.toolchain.resident-concurrency') return 'resident-busy';
  }
  return undefined;
}
