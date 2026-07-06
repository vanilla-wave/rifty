/**
 * OPFS-backed persistent ESM transform cache (ADR-0200) for the dev-server
 * child: one JSON store per `ESM_TRANSFORM_FORMAT` under `esm-transform-cache/`
 * at the OPFS root (outside every project VFS mount), hydrated before the
 * loader's first import. The LOADER validates hits by exact source equality —
 * this store only has to be honest about its own integrity:
 *  - corrupt / foreign-shape / wrong-format / oversized file → discard + delete
 *    + one warn; boot proceeds cold (never a boot failure);
 *  - write failure → one warn, writes disabled (degraded, visible);
 *  - torn flush → next hydrate hits the corrupt path (createWritable commits
 *    atomically on close, so a mid-write crash leaves the OLD file intact);
 *  - concurrent children → whole-file last-wins, each write internally
 *    consistent; lost entries are re-learned next boot.
 * Only `/node_modules/` ids persist — user files churn (backlog item decision).
 */
import {
  ESM_TRANSFORM_FORMAT,
  type PersistentEsmTransformCache,
  type PersistentEsmTransformCacheEntry,
} from '@riftydev/runtime-js/loader';

/** Store-file port — OPFS in production, in-memory in tests. */
export interface EsmTransformCacheStorage {
  /** Byte size without reading; null when the file is absent. */
  size(): Promise<number | null>;
  /** Whole file text; null when absent. */
  read(): Promise<string | null>;
  /** Replace the file with `text` (atomic on commit). */
  write(text: string): Promise<void>;
  /** Delete the file if present. */
  remove(): Promise<void>;
}

const MAX_STORE_BYTES = 64 * 1024 * 1024;
const FLUSH_DELAY_MS = 2_000;

interface StoreShape {
  readonly format: number;
  readonly entries: Record<string, PersistentEsmTransformCacheEntry>;
}

function validEntry(e: unknown): e is PersistentEsmTransformCacheEntry {
  if (typeof e !== 'object' || e === null) return false;
  const { source, result } = e as { source?: unknown; result?: unknown };
  if (typeof source !== 'string' || typeof result !== 'object' || result === null) return false;
  const r = result as { body?: unknown; lineMap?: unknown; staticImports?: unknown; helpers?: unknown };
  return (
    typeof r.body === 'string' &&
    Array.isArray(r.lineMap) &&
    Array.isArray(r.staticImports) &&
    typeof r.helpers === 'object' &&
    r.helpers !== null
  );
}

/**
 * Hydrate a {@link PersistentEsmTransformCache} from `storage`. Every failure
 * mode degrades to an empty store with ONE warn — a cache must never turn into
 * a boot failure (fault: false-fallback).
 */
export async function hydrateEsmTransformCache(
  storage: EsmTransformCacheStorage,
  opts: { readonly warn?: (message: string) => void; readonly flushDelayMs?: number } = {},
): Promise<PersistentEsmTransformCache> {
  const warn = opts.warn ?? ((m) => console.warn(m));
  const flushDelayMs = opts.flushDelayMs ?? FLUSH_DELAY_MS;
  const entries = new Map<string, PersistentEsmTransformCacheEntry>();

  const discard = async (reason: string): Promise<void> => {
    warn(`[esm-transform-cache] discarding store: ${reason}`);
    await storage.remove().catch(() => {});
  };

  try {
    const size = await storage.size();
    if (size !== null && size > MAX_STORE_BYTES) {
      await discard(`file is ${size} bytes (cap ${MAX_STORE_BYTES})`);
    } else if (size !== null) {
      const text = await storage.read();
      if (text !== null) {
        const parsed = JSON.parse(text) as StoreShape;
        if (parsed.format !== ESM_TRANSFORM_FORMAT) {
          await discard(`format ${parsed.format} != ${ESM_TRANSFORM_FORMAT}`);
        } else if (typeof parsed.entries !== 'object' || parsed.entries === null) {
          await discard('entries missing');
        } else {
          for (const [id, entry] of Object.entries(parsed.entries)) {
            if (!validEntry(entry)) {
              entries.clear();
              await discard(`entry for ${id} has a foreign shape`);
              break;
            }
            entries.set(id, entry);
          }
        }
      }
    }
  } catch (err) {
    entries.clear();
    await discard(`unreadable (${(err as Error).message})`);
  }

  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;
  let dirty = false;
  let writesDead = false;
  const flush = (): void => {
    if (flushing) {
      dirty = true; // a put landed mid-write — re-flush after
      return;
    }
    flushing = true;
    dirty = false;
    const shape: StoreShape = { format: ESM_TRANSFORM_FORMAT, entries: Object.fromEntries(entries) };
    void storage
      .write(JSON.stringify(shape))
      .catch((err: unknown) => {
        writesDead = true; // degraded, visibly — the loader keeps running uncached-for-next-boot
        warn(`[esm-transform-cache] write failed, cache disabled: ${(err as Error).message}`);
      })
      .finally(() => {
        flushing = false;
        if (dirty && !writesDead) scheduleFlush();
      });
  };
  const scheduleFlush = (): void => {
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, flushDelayMs);
  };

  return {
    get: (id) => entries.get(id),
    put: (id, entry) => {
      // User files churn per keystroke — only dependency trees amortize.
      if (!id.includes('/node_modules/')) return;
      if (writesDead) return;
      entries.set(id, entry);
      scheduleFlush();
    },
  };
}

/**
 * OPFS storage for {@link hydrateEsmTransformCache}; `null` when OPFS is
 * unavailable in this realm.
 */
export async function createOpfsEsmTransformCacheStorage(): Promise<EsmTransformCacheStorage | null> {
  const storageApi = (globalThis as { navigator?: { storage?: StorageManager } }).navigator
    ?.storage;
  if (!storageApi?.getDirectory) return null;
  const root = await storageApi.getDirectory();
  const dir = await root.getDirectoryHandle('esm-transform-cache', { create: true });
  const fileName = `v${ESM_TRANSFORM_FORMAT}.json`;
  const fileHandle = async (create: boolean) => dir.getFileHandle(fileName, { create });
  const absent = (err: unknown): boolean => (err as { name?: string }).name === 'NotFoundError';
  return {
    async size() {
      try {
        return (await (await fileHandle(false)).getFile()).size;
      } catch (err) {
        if (absent(err)) return null;
        throw err;
      }
    },
    async read() {
      try {
        return await (await (await fileHandle(false)).getFile()).text();
      } catch (err) {
        if (absent(err)) return null;
        throw err;
      }
    },
    async write(text) {
      const writable = await (await fileHandle(true)).createWritable();
      await writable.write(text);
      await writable.close();
    },
    async remove() {
      await dir.removeEntry(fileName).catch((err: unknown) => {
        if (!absent(err)) throw err;
      });
    },
  };
}

/**
 * The dev-server child's one-call assembly: OPFS storage + hydrate, degrading
 * to `undefined` (loader runs uncached) on ANY setup failure, with one warn.
 */
export async function createOpfsEsmTransformCache(
  warn: (message: string) => void = (m) => console.warn(m),
): Promise<PersistentEsmTransformCache | undefined> {
  try {
    const storage = await createOpfsEsmTransformCacheStorage();
    if (!storage) return undefined;
    return await hydrateEsmTransformCache(storage, { warn });
  } catch (err) {
    warn(`[esm-transform-cache] unavailable: ${(err as Error).message}`);
    return undefined;
  }
}
