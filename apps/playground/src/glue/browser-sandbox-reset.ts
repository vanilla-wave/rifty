export interface BrowserSandboxResetFailure {
  readonly name: string;
  readonly reason: string;
}

export interface BrowserSandboxResetResult {
  readonly cleared: readonly string[];
  readonly failed: readonly BrowserSandboxResetFailure[];
}

interface ClearableStorage {
  clear(): void;
}

interface CacheStorageLike {
  keys(): Promise<readonly string[]>;
  delete(key: string): Promise<boolean>;
}

interface IndexedDbLike {
  databases?: () => Promise<readonly { readonly name?: string | null }[]>;
  deleteDatabase(name: string): IDBOpenDBRequest;
}

interface ServiceWorkerContainerLike {
  getRegistrations?: () => Promise<readonly { unregister(): Promise<boolean> }[]>;
}

interface StorageManagerWithDirectory {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
}

interface NavigatorLike {
  readonly storage?: StorageManagerWithDirectory;
  readonly serviceWorker?: ServiceWorkerContainerLike;
}

export interface BrowserSandboxResetDeps {
  readonly navigator?: NavigatorLike;
  readonly localStorage?: ClearableStorage;
  readonly sessionStorage?: ClearableStorage;
  readonly caches?: CacheStorageLike;
  readonly indexedDB?: IndexedDbLike;
}

type OpfsEntryIterable = AsyncIterable<[string, FileSystemHandle]>;

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function clearOpfsRoot(nav: NavigatorLike | undefined): Promise<boolean> {
  const root = await nav?.storage?.getDirectory?.();
  if (!root) return false;
  for await (const [name] of root as unknown as OpfsEntryIterable) {
    await root.removeEntry(name, { recursive: true });
  }
  return true;
}

function deleteDatabase(indexedDB: IndexedDbLike, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`deleteDatabase failed: ${name}`));
    request.onblocked = () => reject(new Error(`deleteDatabase blocked: ${name}`));
  });
}

async function clearIndexedDb(indexedDB: IndexedDbLike | undefined): Promise<boolean> {
  const databases = await indexedDB?.databases?.();
  if (!indexedDB || !databases) return false;
  await Promise.all(
    databases
      .map((db) => db.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .map((name) => deleteDatabase(indexedDB, name)),
  );
  return true;
}

async function unregisterServiceWorkers(nav: NavigatorLike | undefined): Promise<boolean> {
  const registrations = await nav?.serviceWorker?.getRegistrations?.();
  if (!registrations) return false;
  await Promise.all(registrations.map((registration) => registration.unregister()));
  return true;
}

export async function resetBrowserSandboxState(
  deps: BrowserSandboxResetDeps = {
    navigator: globalThis.navigator as NavigatorLike | undefined,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    caches: globalThis.caches,
    indexedDB: globalThis.indexedDB,
  },
): Promise<BrowserSandboxResetResult> {
  const cleared: string[] = [];
  const failed: BrowserSandboxResetFailure[] = [];

  async function step(name: string, clear: () => Promise<boolean> | boolean): Promise<void> {
    try {
      if (await clear()) cleared.push(name);
    } catch (err) {
      failed.push({ name, reason: reasonOf(err) });
    }
  }

  await step('serviceWorker', () => unregisterServiceWorkers(deps.navigator));
  await step('opfs', () => clearOpfsRoot(deps.navigator));
  await step('localStorage', () => {
    deps.localStorage?.clear();
    return deps.localStorage !== undefined;
  });
  await step('sessionStorage', () => {
    deps.sessionStorage?.clear();
    return deps.sessionStorage !== undefined;
  });
  await step('caches', async () => {
    const keys = await deps.caches?.keys();
    if (!keys) return false;
    await Promise.all(keys.map((key) => deps.caches?.delete(key)));
    return true;
  });
  await step('indexedDB', () => clearIndexedDb(deps.indexedDB));

  return { cleared, failed };
}
