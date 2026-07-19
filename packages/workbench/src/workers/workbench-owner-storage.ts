import type {
  ShadowAssetStorage,
  ShadowAssetStorageClass,
  ShadowAssetStorageEntry,
  ShadowAssetStorageSnapshot,
} from '@riftydev/npm-client';
import type { FsSync, PersistFailureReport, Vfs } from '@riftydev/vfs';
import { installMemoryFs, installOpfsFs } from '@riftydev/vfs/internal';
import { runtimeAssetError } from '../workbench/errors.ts';
import {
  type OwnerStoragePersistence,
  type OwnerStorageSnapshot,
  selectOwnerStorage,
} from './owner-storage.ts';
import { type OwnerVfsAuthority, ownerVfsScopeHasFailure } from './owner-vfs-authority.ts';

const PROOF_ROOT = '/.rifty/workbench/v1/storage-proof';
const DEFAULT_PROOF_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();
const RUNTIME_ASSET_ROOT = '/.rifty/workbench/v1/runtime-assets/v1';
const SHA256 = /^[0-9a-f]{64}$/;

const RUNTIME_ASSET_DIRECTORIES = Object.freeze({
  object: `${RUNTIME_ASSET_ROOT}/objects`,
  receipt: `${RUNTIME_ASSET_ROOT}/receipts`,
  ready: `${RUNTIME_ASSET_ROOT}/ready`,
  temp: `${RUNTIME_ASSET_ROOT}/tmp`,
} satisfies Record<ShadowAssetStorageEntry['kind'], string>);

export type WorkbenchOwnerStorageRetention =
  | { readonly available: false }
  | { readonly available: true; readonly persistedAfter: boolean };

interface OpfsInstallation {
  readonly vfs: Vfs;
  readonly fsSync: FsSync & { flush(): Promise<PersistFailureReport> };
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

export function workbenchRuntimeAssetStorageClass(
  storage: OwnerStorageSnapshot,
  retention: WorkbenchOwnerStorageRetention,
): ShadowAssetStorageClass {
  if (storage.backend === 'memory') return 'memory-session';
  return retention.available && retention.persistedAfter ? 'opfs-persisted' : 'opfs-best-effort';
}

function assertSemanticEntry(entry: ShadowAssetStorageEntry): void {
  if (
    entry === null ||
    typeof entry !== 'object' ||
    Object.getPrototypeOf(entry) !== Object.prototype ||
    Reflect.ownKeys(entry).length !== 2 ||
    !Object.hasOwn(entry, 'kind')
  ) {
    throw new TypeError('Runtime asset storage entry must be an exact plain object');
  }
  if (entry.kind === 'temp') {
    if (!Object.hasOwn(entry, 'id') || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new TypeError('Runtime asset temp entry id is invalid');
    }
    return;
  }
  if (entry.kind === 'ready') {
    if (!Object.hasOwn(entry, 'requiredSetDigest') || !SHA256.test(entry.requiredSetDigest)) {
      throw new TypeError('Runtime asset ready-set digest is invalid');
    }
    return;
  }
  if (entry.kind === 'object' || entry.kind === 'receipt') {
    if (!Object.hasOwn(entry, 'sha256') || !SHA256.test(entry.sha256)) {
      throw new TypeError(`Runtime asset ${entry.kind} digest is invalid`);
    }
    return;
  }
  throw new TypeError('Runtime asset storage entry kind is invalid');
}

function encodeTempId(id: string): string {
  return encodeURIComponent(id).replaceAll('.', '%2E');
}

function semanticPath(entry: ShadowAssetStorageEntry): string {
  assertSemanticEntry(entry);
  switch (entry.kind) {
    case 'temp':
      return `${RUNTIME_ASSET_DIRECTORIES.temp}/${encodeTempId(entry.id)}`;
    case 'object':
      return `${RUNTIME_ASSET_DIRECTORIES.object}/${entry.sha256}`;
    case 'receipt':
      return `${RUNTIME_ASSET_DIRECTORIES.receipt}/${entry.sha256}`;
    case 'ready':
      return `${RUNTIME_ASSET_DIRECTORIES.ready}/${entry.requiredSetDigest}`;
  }
}

function decodeSemanticEntry(
  kind: ShadowAssetStorageEntry['kind'],
  name: string,
): ShadowAssetStorageEntry | null {
  if (kind === 'temp') {
    let id: string;
    try {
      id = decodeURIComponent(name);
    } catch {
      return null;
    }
    if (id.length === 0 || encodeTempId(id) !== name) {
      return null;
    }
    return Object.freeze({ kind, id });
  }
  if (!SHA256.test(name)) return null;
  return kind === 'ready'
    ? Object.freeze({ kind, requiredSetDigest: name })
    : Object.freeze({ kind, sha256: name });
}

function inRuntimeAssetScope(path: string): boolean {
  return path === RUNTIME_ASSET_ROOT || path.startsWith(`${RUNTIME_ASSET_ROOT}/`);
}

function finalDurabilityMessage(total: unknown): string {
  return Number.isSafeInteger(total) && (total as number) >= 0
    ? `Workbench owner final durability failed with ${String(total)} unhealed persistence failure(s)`
    : 'Workbench owner final durability failed';
}

/** Safe close projection; full-ledger aggregation stays owner-local. */
export function workbenchFinalDurabilityError(
  report: PersistFailureReport | undefined,
): Error | null {
  if (report === undefined) return null;
  const message = finalDurabilityMessage(report.total);
  let assetFailure: boolean;
  let siblingFailure: boolean;
  try {
    assetFailure = ownerVfsScopeHasFailure(report, inRuntimeAssetScope);
    siblingFailure = ownerVfsScopeHasFailure(report, (path) => !inRuntimeAssetScope(path));
  } catch {
    return new Error(message);
  }
  if (!assetFailure && !siblingFailure) {
    return report.total === 0 ? null : new Error(message);
  }
  if (!assetFailure) return new Error(message);
  const assetError = runtimeAssetError('close', undefined);
  if (!siblingFailure) return assetError;
  return new AggregateError(
    [assetError, new Error(message)],
    'Workbench owner final durability failed',
  );
}

async function acknowledgeRuntimeAssetMutation(authority: OwnerVfsAuthority): Promise<void> {
  const report = await authority.flush();
  if (report === undefined) return;
  if (!ownerVfsScopeHasFailure(report, inRuntimeAssetScope)) return;
  const sample = report.failures.find((failure) => inRuntimeAssetScope(failure.path));
  throw new Error(
    `Runtime asset persistence has ${String(report.total)} unhealed failure(s)${
      sample === undefined ? '' : `: ${sample.op} ${sample.path}: ${sample.message}`
    }`,
  );
}

class WorkbenchRuntimeAssetStorage implements ShadowAssetStorage {
  readonly storageClass: ShadowAssetStorageClass;
  readonly #authority: OwnerVfsAuthority;
  #closed = false;

  constructor(authority: OwnerVfsAuthority, storageClass: ShadowAssetStorageClass) {
    this.#authority = authority;
    this.storageClass = storageClass;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Workbench runtime asset storage is closed');
  }

  async read(entry: ShadowAssetStorageEntry): Promise<Uint8Array | null> {
    this.#assertOpen();
    const path = semanticPath(entry);
    const stat = this.#authority.statSyncOrNull(path);
    if (stat === null) return null;
    if (!stat.isFile) throw new TypeError(`Runtime asset semantic entry is not a file: ${path}`);
    return this.#authority.readFileBytesSync(path).slice();
  }

  async write(entry: ShadowAssetStorageEntry, bytes: Uint8Array): Promise<void> {
    this.#assertOpen();
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('Runtime asset bytes must be Uint8Array');
    const path = semanticPath(entry);
    const parent = path.slice(0, path.lastIndexOf('/'));
    this.#authority.mkdirSync(parent, { recursive: true });
    this.#authority.writeFileSync(path, bytes.slice());
    await acknowledgeRuntimeAssetMutation(this.#authority);
  }

  async remove(entry: ShadowAssetStorageEntry): Promise<void> {
    this.#assertOpen();
    this.#authority.rmSync(semanticPath(entry), { force: true });
    await acknowledgeRuntimeAssetMutation(this.#authority);
  }

  async inspect(): Promise<ShadowAssetStorageSnapshot> {
    this.#assertOpen();
    const entries: Array<{
      readonly entry: ShadowAssetStorageEntry;
      readonly byteLength: number;
    }> = [];
    let entryCount = 0;
    let storedBytes = 0;
    const root = this.#authority.statSyncOrNull(RUNTIME_ASSET_ROOT);
    if (root?.isFile) {
      const bytes = this.#authority.readFileBytesSync(RUNTIME_ASSET_ROOT);
      return Object.freeze({
        entryCount: 1,
        storedBytes: bytes.byteLength,
        entries: Object.freeze([]),
      });
    }
    const pendingDirectories = root?.isDirectory ? [RUNTIME_ASSET_ROOT] : [];
    for (let index = 0; index < pendingDirectories.length; index += 1) {
      const directory = pendingDirectories[index] as string;
      const semanticKind = (
        Object.entries(RUNTIME_ASSET_DIRECTORIES) as Array<
          [ShadowAssetStorageEntry['kind'], string]
        >
      ).find(([, candidate]) => candidate === directory)?.[0];
      const children = [...this.#authority.readdirSync(directory)].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      for (const child of children) {
        const path = `${directory}/${child.name}`;
        if (child.isDirectory) {
          pendingDirectories.push(path);
          continue;
        }
        if (!child.isFile) continue;
        const bytes = this.#authority.readFileBytesSync(path);
        entryCount += 1;
        storedBytes += bytes.byteLength;
        if (!Number.isSafeInteger(storedBytes)) {
          throw new RangeError('Runtime asset stored byte count exceeds the safe integer range');
        }
        if (semanticKind === undefined) continue;
        const entry = decodeSemanticEntry(semanticKind, child.name);
        if (entry === null) continue;
        entries.push(
          Object.freeze({
            entry,
            byteLength: bytes.byteLength,
          }),
        );
      }
    }
    return Object.freeze({
      entryCount,
      storedBytes,
      entries: Object.freeze(entries),
    });
  }

  async clear(): Promise<void> {
    this.#assertOpen();
    // A prior persisted rm can fail after the mirror already removed this
    // root. Recreate an empty tombstone so retry enqueues a fresh physical rm.
    if (this.#authority.statSyncOrNull(RUNTIME_ASSET_ROOT) === null) {
      this.#authority.mkdirSync(RUNTIME_ASSET_ROOT, { recursive: true });
    }
    this.#authority.rmSync(RUNTIME_ASSET_ROOT, { recursive: true, force: true });
    await acknowledgeRuntimeAssetMutation(this.#authority);
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}

/** Private semantic adapter over the one owner VFS authority. */
export function createWorkbenchRuntimeAssetStorage(
  authority: OwnerVfsAuthority,
  storageClass: ShadowAssetStorageClass,
): ShadowAssetStorage {
  if (
    storageClass !== 'opfs-persisted' &&
    storageClass !== 'opfs-best-effort' &&
    storageClass !== 'memory-session'
  ) {
    throw new TypeError('Runtime asset storage class is invalid');
  }
  return new WorkbenchRuntimeAssetStorage(authority, storageClass);
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

/** Installs exactly one owner-realm backend and returns its owner-born truth. */
export function installWorkbenchOwnerStorage(
  policy: OwnerStoragePersistence,
  options: WorkbenchOwnerStorageOptions = {},
): Promise<OwnerStorageSnapshot> {
  const timeoutMs = options.proofTimeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError('Workbench OPFS proof timeout must be positive'));
  }
  const installers = options.installers ?? defaultInstallers();
  const createProofId = options.createProofId ?? defaultProofId;
  return selectOwnerStorage(policy, {
    openMemory: () => installers.openMemory(),
    openOpfs: () => installers.openOpfs(),
    proveOpfs: (installation) => proveOpfs(installation, createProofId(), timeoutMs),
  });
}
