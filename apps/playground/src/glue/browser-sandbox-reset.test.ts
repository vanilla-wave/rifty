import { describe, expect, it, vi } from 'vitest';
import { resetBrowserSandboxState } from './browser-sandbox-reset.ts';

class FakeOpfsRoot {
  readonly removed: Array<{ name: string; recursive: boolean }> = [];
  private readonly names: readonly string[];

  constructor(names: readonly string[]) {
    this.names = names;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<[string, unknown]> {
    for (const name of this.names) yield [name, {}];
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    this.removed.push({ name, recursive: options?.recursive === true });
  }
}

class FakeStorage {
  clear = vi.fn();
}

function deleteDatabaseOk(name: string): IDBOpenDBRequest {
  const request = {
    error: null,
    result: undefined,
    source: null,
    transaction: null,
    onblocked: null,
    onerror: null,
    onsuccess: null,
  } as unknown as IDBOpenDBRequest;
  queueMicrotask(() => request.onsuccess?.call(request, new Event(`success:${name}`)));
  return request;
}

describe('resetBrowserSandboxState', () => {
  it('treats throwing web-storage getters as unavailable during a best-effort reset', async () => {
    const localDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const sessionDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    for (const name of ['localStorage', 'sessionStorage'] as const) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new DOMException('opaque origin', 'SecurityError');
        },
      });
    }
    try {
      await expect(resetBrowserSandboxState()).resolves.toEqual(
        expect.objectContaining({ failed: [] }),
      );
    } finally {
      if (localDescriptor === undefined) Reflect.deleteProperty(globalThis, 'localStorage');
      else Object.defineProperty(globalThis, 'localStorage', localDescriptor);
      if (sessionDescriptor === undefined) Reflect.deleteProperty(globalThis, 'sessionStorage');
      else Object.defineProperty(globalThis, 'sessionStorage', sessionDescriptor);
    }
  });

  it('clears OPFS, web storage, caches, and IndexedDB databases best-effort', async () => {
    const root = new FakeOpfsRoot(['scratch', 'projects', '.rifty-project-index.json']);
    const localStorage = new FakeStorage();
    const sessionStorage = new FakeStorage();
    const deletedCaches: string[] = [];
    const deletedDbs: string[] = [];

    const result = await resetBrowserSandboxState({
      navigator: {
        storage: { getDirectory: async () => root as unknown as FileSystemDirectoryHandle },
      },
      localStorage,
      sessionStorage,
      caches: {
        keys: async () => ['vite', 'preview'],
        delete: async (key) => {
          deletedCaches.push(key);
          return true;
        },
      },
      indexedDB: {
        databases: async () => [{ name: 'rifty-a' }, { name: undefined }, { name: 'rifty-b' }],
        deleteDatabase: (name) => {
          deletedDbs.push(name);
          return deleteDatabaseOk(name);
        },
      },
    });

    expect(root.removed).toEqual([
      { name: 'scratch', recursive: true },
      { name: 'projects', recursive: true },
      { name: '.rifty-project-index.json', recursive: true },
    ]);
    expect(localStorage.clear).toHaveBeenCalledOnce();
    expect(sessionStorage.clear).toHaveBeenCalledOnce();
    expect(deletedCaches).toEqual(['vite', 'preview']);
    expect(deletedDbs).toEqual(['rifty-a', 'rifty-b']);
    expect(result.failed).toEqual([]);
  });

  it('continues clearing remaining stores when one store throws', async () => {
    const sessionStorage = new FakeStorage();
    const result = await resetBrowserSandboxState({
      navigator: {
        storage: {
          getDirectory: async () => {
            throw new Error('blocked');
          },
        },
      },
      localStorage: {
        clear: () => {
          throw new Error('quota weirdness');
        },
      },
      sessionStorage,
      caches: { keys: async () => [], delete: async () => true },
      indexedDB: { databases: async () => [], deleteDatabase: deleteDatabaseOk },
    });

    expect(sessionStorage.clear).toHaveBeenCalledOnce();
    expect(result.failed.map((step) => step.name)).toEqual(['opfs', 'localStorage']);
  });
});
