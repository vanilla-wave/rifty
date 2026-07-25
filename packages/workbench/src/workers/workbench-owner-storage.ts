import type { FsSync, PersistFailureReport, Vfs } from '@riftydev/vfs';
import { installMemoryFs, installOpfsFs } from '@riftydev/vfs/internal';
import {
  type OwnerStoragePersistence,
  type OwnerStorageSnapshot,
  selectOwnerStorage,
} from './owner-storage.ts';

const PROOF_ROOT = '/.rifty/workbench/v1/storage-proof';
const DEFAULT_PROOF_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();

interface OpfsInstallation {
  readonly vfs: Vfs;
  readonly fsSync: FsSync & { flush(): Promise<PersistFailureReport> };
}

export interface WorkbenchOwnerStorageAuthority {
  /** Clone-safe owner truth used by page/worker protocol messages. */
  readonly snapshot: OwnerStorageSnapshot;
  /** Present only while the selected backend is the proven OPFS installation. */
  readonly opfs?: Readonly<{
    persistedVfs: Vfs;
    flush(): Promise<PersistFailureReport>;
  }>;
}

export interface WorkbenchOwnerStorageInstallers {
  openMemory(): void | Promise<void>;
  openOpfs(): Promise<OpfsInstallation>;
}

export interface WorkbenchOwnerStorageOptions {
  readonly installers?: WorkbenchOwnerStorageInstallers;
  readonly proofTimeoutMs?: number;
  readonly createProofId?: () => string;
}

function defaultProofId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Workbench OPFS proof requires cryptographic randomUUID support');
  }
  return globalThis.crypto.randomUUID();
}

function defaultInstallers(): WorkbenchOwnerStorageInstallers {
  return Object.freeze({
    openMemory: () => {
      installMemoryFs();
    },
    openOpfs: installOpfsFs,
  });
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
      timeoutMs,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function assertCleanFlush(report: PersistFailureReport, label: string): void {
  if (report.total === 0) return;
  const sample = report.failures[0];
  throw new Error(
    `${label} reported ${String(report.total)} unhealed persistence failure(s)${
      sample ? `: ${sample.path} ${sample.message}` : ''
    }`,
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

async function proveOpfs(
  installation: OpfsInstallation,
  proofId: string,
  timeoutMs: number,
): Promise<void> {
  if (!/^[A-Za-z0-9-]+$/.test(proofId)) {
    throw new TypeError('Workbench OPFS proof id must be an alphanumeric token');
  }
  const path = `${PROOF_ROOT}/${proofId}`;
  const expected = encoder.encode(`workbench-owner-storage-proof-v1:${proofId}`);
  let proofFailure: unknown;
  try {
    installation.fsSync.mkdirSync(PROOF_ROOT, { recursive: true });
    installation.fsSync.writeFileSync(path, expected);
    const report = await withTimeout(
      installation.fsSync.flush(),
      timeoutMs,
      'Workbench OPFS proof flush',
    );
    assertCleanFlush(report, 'Workbench OPFS proof flush');
    const persisted = await withTimeout(
      installation.vfs.readFile(path),
      timeoutMs,
      'Workbench OPFS persisted read',
    );
    if (!equalBytes(persisted, expected)) {
      throw new Error('Workbench OPFS persisted bytes mismatch');
    }
  } catch (error) {
    proofFailure = error;
  }

  let cleanupFailure: unknown;
  try {
    installation.fsSync.rmSync(path, { force: true });
    const cleanup = await withTimeout(
      installation.fsSync.flush(),
      timeoutMs,
      'Workbench OPFS proof cleanup',
    );
    assertCleanFlush(cleanup, 'Workbench OPFS proof cleanup');
  } catch (error) {
    cleanupFailure = error;
  }

  if (proofFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [proofFailure, cleanupFailure],
      'Workbench OPFS proof and cleanup failed',
    );
  }
  if (proofFailure !== undefined) throw proofFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
}

/** Installs one backend and retains the private persisted OPFS read-back surface. */
export async function installWorkbenchOwnerStorageAuthority(
  policy: OwnerStoragePersistence,
  options: WorkbenchOwnerStorageOptions = {},
): Promise<WorkbenchOwnerStorageAuthority> {
  const timeoutMs = options.proofTimeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Workbench OPFS proof timeout must be positive');
  }
  const installers = options.installers ?? defaultInstallers();
  const createProofId = options.createProofId ?? defaultProofId;
  let openedOpfs: OpfsInstallation | undefined;
  const snapshot = await selectOwnerStorage(policy, {
    openMemory: () => installers.openMemory(),
    openOpfs: async () => {
      const installation = await installers.openOpfs();
      openedOpfs = installation;
      return installation;
    },
    proveOpfs: (installation) => proveOpfs(installation, createProofId(), timeoutMs),
  });
  if (snapshot.backend !== 'opfs') return Object.freeze({ snapshot });
  if (openedOpfs === undefined) {
    throw new Error('Workbench OPFS selection lost its private installation handle');
  }
  const installation = openedOpfs;
  return Object.freeze({
    snapshot,
    opfs: Object.freeze({
      persistedVfs: installation.vfs,
      flush: () => installation.fsSync.flush(),
    }),
  });
}
