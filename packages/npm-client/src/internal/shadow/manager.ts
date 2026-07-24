import {
  type ShadowRuntimeAsset,
  canonicalShadowJson,
  shadowSha256,
} from '@riftydev/shadow-registry/internal';
import { type PersistFailureReport, type Vfs, joinPath } from '@riftydev/vfs';
import { type ShadowAssetPlan, decodeShadowAssetPlan } from './planner.ts';
import { type ShadowAssetPortServer, serveTrustedReadyShadowAssets } from './port.ts';

export type ShadowAssetStorageClass = 'opfs-persisted' | 'opfs-best-effort' | 'memory-session';
export type ShadowAssetStorageEntry =
  | Readonly<{ kind: 'object'; sha256: string }>
  | Readonly<{ kind: 'receipt'; sha256: string }>
  | Readonly<{ kind: 'ready'; requiredSetDigest: string }>;

export interface ShadowAssetStorage {
  readonly storageClass: ShadowAssetStorageClass;
  read(entry: ShadowAssetStorageEntry): Promise<Uint8Array | null>;
  write(entry: ShadowAssetStorageEntry, bytes: Uint8Array): Promise<void>;
  remove(entry: ShadowAssetStorageEntry): Promise<void>;
  close(): Promise<void>;
}

export interface ShadowAssetVfsDurability {
  /** Actual async OPFS surface. Reads here must not observe only the sync mirror. */
  readonly persistedVfs: Vfs;
  /** Drains the mutation VFS write-through before persistedVfs is inspected. */
  flush(): Promise<PersistFailureReport>;
}

export interface ShadowAssetSource {
  acquire(asset: Readonly<ShadowRuntimeAsset>, signal: AbortSignal): Promise<Uint8Array>;
}

export interface ShadowAssetReceipt {
  readonly schema: 1;
  readonly receiptSha256: string;
  readonly requiredSetDigest: string;
  readonly storageClass: ShadowAssetStorageClass;
  readonly assets: readonly Readonly<{ id: string; memberSha256: string; memberSize: number }>[];
}

export interface ShadowAssetReadySet {
  readonly plan: ShadowAssetPlan;
  readonly receipt: ShadowAssetReceipt;
}

export interface PackageTreeShadowAssetBoundary {
  ensure(plan: ShadowAssetPlan): Promise<ShadowAssetReadySet>;
  serve(ready: ShadowAssetReadySet, port: MessagePort): ShadowAssetPortServer;
}

export interface OriginExclusiveShadowAssetManager extends PackageTreeShadowAssetBoundary {
  close(): Promise<void>;
}

export class ShadowAssetError extends Error {
  readonly code = 'ESHADOWASSET' as const;
  constructor(
    readonly phase: 'acquire' | 'verify' | 'persist' | 'ready' | 'close',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ShadowAssetError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const SHA = /^[0-9a-f]{64}$/;

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freezeDeep(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function key(entry: ShadowAssetStorageEntry): string {
  if (
    entry === null ||
    typeof entry !== 'object' ||
    Object.getPrototypeOf(entry) !== Object.prototype
  ) {
    throw new TypeError('shadow storage entry must be a plain object');
  }
  const descriptors = Object.getOwnPropertyDescriptors(entry);
  if (Object.getOwnPropertySymbols(entry).length > 0) {
    throw new TypeError('shadow storage entry has symbols');
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!('value' in descriptor)) throw new TypeError('shadow storage entry has accessors');
  }
  const expected = entry.kind === 'ready' ? ['kind', 'requiredSetDigest'] : ['kind', 'sha256'];
  const actual = Object.keys(descriptors).sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== [...expected].sort()[index])
  ) {
    throw new TypeError('shadow storage entry has extra or missing fields');
  }
  if (entry.kind === 'ready') {
    if (!SHA.test(entry.requiredSetDigest)) throw new TypeError('shadow ready digest is invalid');
  } else {
    if (entry.kind !== 'object' && entry.kind !== 'receipt') {
      throw new TypeError('shadow storage entry kind is invalid');
    }
    if (!SHA.test(entry.sha256)) throw new TypeError('shadow storage SHA is invalid');
  }
  if (entry.kind === 'ready') return `ready/${entry.requiredSetDigest}`;
  return `${entry.kind}/${entry.sha256}`;
}

class MemoryShadowAssetStorage implements ShadowAssetStorage {
  readonly storageClass = 'memory-session' as const;
  readonly #entries = new Map<string, Uint8Array>();
  #closed = false;
  async read(entry: ShadowAssetStorageEntry) {
    if (this.#closed) throw new Error('shadow memory storage is closed');
    return this.#entries.get(key(entry))?.slice() ?? null;
  }
  async write(entry: ShadowAssetStorageEntry, bytes: Uint8Array) {
    if (this.#closed) throw new Error('shadow memory storage is closed');
    this.#entries.set(key(entry), bytes.slice());
  }
  async remove(entry: ShadowAssetStorageEntry) {
    this.#entries.delete(key(entry));
  }
  async close() {
    this.#closed = true;
  }
}

export function createMemoryShadowAssetStorage(): ShadowAssetStorage {
  return new MemoryShadowAssetStorage();
}

const VFS_STORE_ROOT = '/.rifty/shadow-assets/v1';

/** Persistent semantic store over a real VFS (OpfsVfs in production). */
export function createVfsShadowAssetStorage(
  vfs: Vfs,
  storageClass: Exclude<ShadowAssetStorageClass, 'memory-session'>,
  durability: ShadowAssetVfsDurability,
): ShadowAssetStorage {
  if (storageClass !== 'opfs-persisted' && storageClass !== 'opfs-best-effort') {
    throw new TypeError('VFS shadow store requires an honest OPFS storage class');
  }
  if (
    durability === null ||
    typeof durability !== 'object' ||
    typeof durability.flush !== 'function' ||
    durability.persistedVfs === null ||
    typeof durability.persistedVfs !== 'object'
  ) {
    throw new TypeError('VFS shadow store requires a durable OPFS read-back boundary');
  }
  let closed = false;
  const path = (entry: ShadowAssetStorageEntry) => joinPath(VFS_STORE_ROOT, key(entry));
  const persistedRead = async (target: string): Promise<Uint8Array | null> =>
    (await durability.persistedVfs.exists(target))
      ? await durability.persistedVfs.readFile(target)
      : null;
  const flushDurably = async (operation: 'write' | 'remove'): Promise<void> => {
    const report = await durability.flush();
    if (report.total === 0) return;
    const detail = report.failures
      .map((failure) => `${failure.op} ${failure.path}: ${failure.message}`)
      .join('; ');
    throw new Error(
      `shadow VFS ${operation} has ${String(report.total)} unhealed persistence failure(s)${
        detail ? `: ${detail}` : ''
      }`,
    );
  };
  const durableRemove = async (target: string): Promise<void> => {
    await vfs.rm(target, { force: true });
    await flushDurably('remove');
    if (await durability.persistedVfs.exists(target)) {
      throw new Error(`shadow VFS removal did not persist for ${target}`);
    }
  };
  const adapter: ShadowAssetStorage = {
    storageClass,
    async read(entry) {
      if (closed) throw new Error('shadow VFS storage is closed');
      return await persistedRead(path(entry));
    },
    async write(entry, bytes) {
      if (closed) throw new Error('shadow VFS storage is closed');
      if (!(bytes instanceof Uint8Array))
        throw new TypeError('shadow storage bytes must be Uint8Array');
      const target = path(entry);
      try {
        await vfs.mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
        await vfs.writeFile(target, bytes);
        await flushDurably('write');
        const persisted = await persistedRead(target);
        if (
          persisted === null ||
          persisted.byteLength !== bytes.byteLength ||
          !persisted.every((byte, index) => byte === bytes[index])
        ) {
          throw new Error(`shadow VFS write did not persist for ${target}`);
        }
      } catch (error) {
        if (entry.kind !== 'ready') throw error;
        try {
          await durableRemove(target);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `shadow ready write and rollback failed for ${target}`,
          );
        }
        throw error;
      }
    },
    async remove(entry) {
      if (closed) throw new Error('shadow VFS storage is closed');
      await durableRemove(path(entry));
    },
    async close() {
      closed = true;
    },
  };
  return Object.freeze(adapter);
}

export async function probeBrowserShadowAssetStorageClass(
  opfsAvailable: boolean,
  storage: Pick<StorageManager, 'persisted' | 'persist'> | undefined = globalThis.navigator
    ?.storage,
): Promise<ShadowAssetStorageClass> {
  if (!opfsAvailable) return 'memory-session';
  if (storage === undefined) return 'opfs-best-effort';
  try {
    if (await storage.persisted()) return 'opfs-persisted';
    return (await storage.persist()) ? 'opfs-persisted' : 'opfs-best-effort';
  } catch {
    return 'opfs-best-effort';
  }
}

function parseCanonical(bytes: Uint8Array, label: string): Record<string, unknown> {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch (error) {
    throw new ShadowAssetError('ready', `${label} is not UTF-8`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ShadowAssetError('ready', `${label} is not JSON`, { cause: error });
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalShadowJson(value) !== text
  ) {
    throw new ShadowAssetError('ready', `${label} is not canonical JSON`);
  }
  return value as Record<string, unknown>;
}

function receiptPayload(plan: ShadowAssetPlan, storageClass: ShadowAssetStorageClass) {
  return {
    schema: 1 as const,
    requiredSetDigest: plan.requiredSetDigest,
    storageClass,
    assets: plan.assets.map(({ id, memberSha256, memberSize }) => ({
      id,
      memberSha256,
      memberSize,
    })),
  };
}

function decodeReceipt(
  bytes: Uint8Array,
  sha256: string,
  plan: ShadowAssetPlan,
): ShadowAssetReceipt {
  if (shadowSha256(bytes) !== sha256)
    throw new ShadowAssetError('ready', 'receipt digest mismatch');
  const parsed = parseCanonical(bytes, 'shadow receipt');
  const expected = receiptPayload(plan, parsed.storageClass as ShadowAssetStorageClass);
  if (canonicalShadowJson(parsed) !== canonicalShadowJson(expected))
    throw new ShadowAssetError('ready', 'receipt does not match plan');
  if (
    !['opfs-persisted', 'opfs-best-effort', 'memory-session'].includes(String(parsed.storageClass))
  ) {
    throw new ShadowAssetError('ready', 'receipt storage class is invalid');
  }
  return freezeDeep({ ...expected, receiptSha256: sha256 });
}

/** Construct only inside the origin-wide Workbench Web Lock callback. */
export function createOriginExclusiveShadowAssetManager(
  options: Readonly<{
    storage: ShadowAssetStorage;
    source: ShadowAssetSource;
  }>,
): OriginExclusiveShadowAssetManager {
  const storage = options.storage;
  const source = options.source;
  const readyOwned = new WeakMap<object, AbortSignal>();
  const active = new Set<Promise<unknown>>();
  let state: 'open' | 'closed' = 'open';
  const lifecycleController = new AbortController();
  let closePromise: Promise<void> | null = null;
  const track = <T>(operation: Promise<T>): Promise<T> => {
    active.add(operation);
    void operation.finally(() => active.delete(operation)).catch(() => {});
    return operation;
  };
  const readStorage = async (
    entry: ShadowAssetStorageEntry,
    phase: 'ready' | 'persist',
  ): Promise<Uint8Array | null> => {
    try {
      return await storage.read(entry);
    } catch (error) {
      throw new ShadowAssetError(phase, `shadow storage read failed for ${key(entry)}`, {
        cause: error,
      });
    }
  };
  const writeStorage = async (entry: ShadowAssetStorageEntry, bytes: Uint8Array): Promise<void> => {
    try {
      await storage.write(entry, bytes);
    } catch (error) {
      throw new ShadowAssetError('persist', `shadow storage write failed for ${key(entry)}`, {
        cause: error,
      });
    }
  };
  const readObject = async (
    asset: Readonly<ShadowRuntimeAsset>,
    lifecycle: AbortSignal,
  ): Promise<Uint8Array | null> => {
    const bytes = await readStorage({ kind: 'object', sha256: asset.memberSha256 }, 'ready');
    if (lifecycle.aborted) {
      throw new ShadowAssetError('ready', 'shadow asset manager closed during read');
    }
    if (
      !bytes ||
      bytes.byteLength !== asset.memberSize ||
      shadowSha256(bytes) !== asset.memberSha256
    )
      return null;
    return bytes.slice();
  };
  const readReady = async (
    plan: ShadowAssetPlan,
    lifecycle: AbortSignal,
  ): Promise<ShadowAssetReadySet | null> => {
    const pointerBytes = await readStorage(
      { kind: 'ready', requiredSetDigest: plan.requiredSetDigest },
      'ready',
    );
    if (!pointerBytes) return null;
    let pointer: Record<string, unknown>;
    try {
      pointer = parseCanonical(pointerBytes, 'shadow ready pointer');
    } catch {
      return null;
    }
    if (
      Object.keys(pointer).sort().join('\0') !==
        ['receiptSha256', 'requiredSetDigest', 'schema'].sort().join('\0') ||
      pointer.schema !== 1 ||
      pointer.requiredSetDigest !== plan.requiredSetDigest ||
      typeof pointer.receiptSha256 !== 'string' ||
      !SHA.test(pointer.receiptSha256)
    ) {
      return null;
    }
    const receiptBytes = await readStorage(
      { kind: 'receipt', sha256: pointer.receiptSha256 },
      'ready',
    );
    if (!receiptBytes) return null;
    let receipt: ShadowAssetReceipt;
    try {
      receipt = decodeReceipt(receiptBytes, pointer.receiptSha256, plan);
    } catch {
      return null;
    }
    if (receipt.storageClass !== storage.storageClass) return null;
    for (const asset of plan.assets) {
      if ((await readObject(asset, lifecycle)) === null) return null;
    }
    return Object.freeze({ plan, receipt });
  };
  const publish = async (
    plan: ShadowAssetPlan,
    lifecycle: AbortSignal,
  ): Promise<ShadowAssetReadySet> => {
    for (const asset of plan.assets) {
      if ((await readObject(asset, lifecycle)) !== null) continue;
      let bytes: Uint8Array;
      try {
        bytes = await source.acquire(asset, lifecycle);
      } catch (error) {
        throw new ShadowAssetError('acquire', `failed to acquire ${asset.id}`, { cause: error });
      }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== asset.memberSize) {
        throw new ShadowAssetError('verify', `asset ${asset.id} size mismatch`);
      }
      await writeStorage({ kind: 'object', sha256: asset.memberSha256 }, bytes);
      const readBack = await readStorage({ kind: 'object', sha256: asset.memberSha256 }, 'persist');
      if (
        !readBack ||
        readBack.byteLength !== asset.memberSize ||
        shadowSha256(readBack) !== asset.memberSha256
      ) {
        throw new ShadowAssetError('persist', `asset ${asset.id} read-back mismatch`);
      }
    }
    const payload = receiptPayload(plan, storage.storageClass);
    const receiptBytes = encoder.encode(canonicalShadowJson(payload));
    const receiptSha256 = shadowSha256(receiptBytes);
    await writeStorage({ kind: 'receipt', sha256: receiptSha256 }, receiptBytes);
    const receiptReadBack = await readStorage(
      { kind: 'receipt', sha256: receiptSha256 },
      'persist',
    );
    if (!receiptReadBack || shadowSha256(receiptReadBack) !== receiptSha256)
      throw new ShadowAssetError('persist', 'receipt read-back mismatch');
    const pointer = encoder.encode(
      canonicalShadowJson({ schema: 1, requiredSetDigest: plan.requiredSetDigest, receiptSha256 }),
    );
    const readyEntry = { kind: 'ready' as const, requiredSetDigest: plan.requiredSetDigest };
    await writeStorage(readyEntry, pointer);
    const pointerReadBack = await readStorage(readyEntry, 'persist');
    if (
      !pointerReadBack ||
      canonicalShadowJson(parseCanonical(pointerReadBack, 'shadow ready pointer')) !==
        decoder.decode(pointer)
    ) {
      await storage.remove(readyEntry);
      throw new ShadowAssetError('persist', 'ready pointer read-back mismatch');
    }
    return Object.freeze({
      plan,
      receipt: decodeReceipt(receiptReadBack, receiptSha256, plan),
    });
  };
  const manager: OriginExclusiveShadowAssetManager = {
    ensure(planValue) {
      if (state !== 'open')
        return Promise.reject(new ShadowAssetError('ready', `manager is ${state}`));
      const plan = decodeShadowAssetPlan(planValue);
      const lifecycle = lifecycleController.signal;
      return track(
        (async () => {
          const ready = (await readReady(plan, lifecycle)) ?? (await publish(plan, lifecycle));
          if (state !== 'open' || lifecycle.aborted) {
            throw new ShadowAssetError('ready', 'shadow readiness invalidated during ensure');
          }
          readyOwned.set(ready, lifecycle);
          return ready;
        })(),
      );
    },
    serve(ready, port) {
      const lifecycle = readyOwned.get(ready);
      if (state !== 'open' || lifecycle === undefined || lifecycle.aborted) {
        throw new ShadowAssetError('ready', 'ready set is stale or not owned by this manager');
      }
      return serveTrustedReadyShadowAssets(port, {
        plan: ready.plan,
        read: async (assetId) => {
          if (state !== 'open' || lifecycle.aborted) {
            throw new ShadowAssetError('ready', `manager is ${state}`);
          }
          const asset = ready.plan.assets.find((candidate) => candidate.id === assetId);
          if (!asset) throw new ShadowAssetError('ready', `asset ${assetId} is not admitted`);
          const bytes = await track(readObject(asset, lifecycle));
          if (!bytes)
            throw new ShadowAssetError('ready', `asset store cleared during read of ${assetId}`);
          return bytes;
        },
      });
    },
    close() {
      if (closePromise !== null) return closePromise;
      state = 'closed';
      closePromise = Promise.resolve().then(async () => {
        lifecycleController.abort(
          new ShadowAssetError('close', 'shadow asset acquisition cancelled by close'),
        );
        await Promise.allSettled([...active]);
        await storage.close();
      });
      return closePromise;
    },
  };
  return Object.freeze(manager);
}
