import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { canonicalShadowJson, shadowSha256 } from '@riftydev/shadow-registry/internal';
import { MemoryVfs, type Vfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  ShadowAssetError,
  type ShadowAssetStorage,
  type ShadowAssetStorageEntry,
  createMemoryShadowAssetStorage,
  createOriginExclusiveShadowAssetManager,
  createVfsShadowAssetStorage,
  probeBrowserShadowAssetStorageClass,
} from './manager.ts';
import {
  type ShadowAssetPlan,
  attestBuiltinShadowSubstitution,
  planAppliedShadowSubstitutions,
} from './planner.ts';
import { createShadowAssetPortClient } from './port.ts';
import { strictShadowPlanCodecCases } from './strict-codec.contract-fixtures.ts';

const plan = planAppliedShadowSubstitutions([
  attestBuiltinShadowSubstitution({
    trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
    installPath: 'node_modules/esbuild',
    acquisition: { kind: 'synthetic' },
  }),
]);

const requireFromRegistry = createRequire(
  new URL('../../../../../tools/shadow-registry/package.json', import.meta.url),
);
const assetBytes = new Uint8Array(
  await readFile(requireFromRegistry.resolve('esbuild-wasm/esbuild.wasm')),
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function adaptVfs(
  base: Vfs,
  overrides: Readonly<{
    readFile?: Vfs['readFile'];
    writeFile?: Vfs['writeFile'];
  }>,
): Vfs {
  return {
    readFile: overrides.readFile ?? ((path) => base.readFile(path)),
    readFileText: (path, encoding) => base.readFileText(path, encoding),
    writeFile: overrides.writeFile ?? ((path, data) => base.writeFile(path, data)),
    readdir: (path) => base.readdir(path),
    mkdir: (path, options) => base.mkdir(path, options),
    rm: (path, options) => base.rm(path, options),
    stat: (path) => base.stat(path),
    exists: (path) => base.exists(path),
    utimes: (path, atimeMs, mtimeMs) => base.utimes(path, atimeMs, mtimeMs),
    openReadable: (path, options) => base.openReadable(path, options),
  };
}

describe('shadow asset manager contract', () => {
  it.each(strictShadowPlanCodecCases)(
    'strict-decodes $name at manager ensure ingress',
    async ({ value }) => {
      const manager = createOriginExclusiveShadowAssetManager({
        storage: createMemoryShadowAssetStorage(),
        source: {
          acquire: async () => {
            throw new Error('invalid plan must not acquire');
          },
        },
      });

      await expect(
        Promise.resolve().then(() => manager.ensure(value() as ShadowAssetPlan)),
      ).rejects.toBeInstanceOf(ShadowAssetError);
    },
  );

  it('publishes object → receipt → ready and cold-reopens without acquisition', async () => {
    const base = createMemoryShadowAssetStorage();
    const writes: ShadowAssetStorageEntry[] = [];
    const storage: ShadowAssetStorage = {
      storageClass: base.storageClass,
      read: (entry) => base.read(entry),
      write: async (entry, bytes) => {
        writes.push(entry);
        await base.write(entry, bytes);
      },
      remove: (entry) => base.remove(entry),
      close: () => Promise.resolve(),
    };
    let acquisitions = 0;
    const acquire = async () => {
      acquisitions += 1;
      return assetBytes;
    };
    const manager = createOriginExclusiveShadowAssetManager({ storage, source: { acquire } });
    await expect(manager.ensure(plan)).resolves.toMatchObject({
      receipt: { requiredSetDigest: plan.requiredSetDigest },
    });
    expect(writes.map((entry) => entry.kind)).toEqual(['object', 'receipt', 'ready']);
    expect(acquisitions).toBe(1);

    const reopened = createOriginExclusiveShadowAssetManager({
      storage,
      source: {
        acquire: async () => {
          throw new Error('cold reopen must not acquire');
        },
      },
    });
    await expect(reopened.ensure(plan)).resolves.toMatchObject({
      receipt: { requiredSetDigest: plan.requiredSetDigest },
    });
  });

  it('deep-freezes public receipts and readiness', async () => {
    const manager = createOriginExclusiveShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: { acquire: async () => assetBytes },
    });
    const ready = await manager.ensure(plan);
    expect(Object.isFrozen(ready)).toBe(true);
    expect(Object.isFrozen(ready.receipt)).toBe(true);
    expect(Object.isFrozen(ready.receipt.assets)).toBe(true);
    expect(Object.isFrozen(ready.receipt.assets[0])).toBe(true);
    expect(Reflect.set(ready.receipt.assets[0]!, 'memberSize', 1)).toBe(false);
    expect(ready.receipt.assets[0]?.memberSize).toBe(plan.assets[0]?.memberSize);
  });

  it('does not publish a ready pointer for corrupt acquired bytes', async () => {
    const base = createMemoryShadowAssetStorage();
    const writes: ShadowAssetStorageEntry[] = [];
    const storage: ShadowAssetStorage = {
      storageClass: base.storageClass,
      read: (entry) => base.read(entry),
      write: async (entry, bytes) => {
        writes.push(entry);
        await base.write(entry, bytes);
      },
      remove: (entry) => base.remove(entry),
      close: () => Promise.resolve(),
    };
    const manager = createOriginExclusiveShadowAssetManager({
      storage,
      source: { acquire: async () => new Uint8Array(plan.assets[0]!.memberSize) },
    });
    await expect(manager.ensure(plan)).rejects.toMatchObject({ code: 'ESHADOWASSET' });
    expect(writes.some((entry) => entry.kind === 'ready')).toBe(false);
  });

  it('treats malformed or extra-field ready pointers as absent and republishes exact readiness', async () => {
    const storage = createMemoryShadowAssetStorage();
    const first = createOriginExclusiveShadowAssetManager({
      storage,
      source: { acquire: async () => assetBytes },
    });
    await first.ensure(plan);
    for (const bytes of [
      new TextEncoder().encode('{not-json'),
      new TextEncoder().encode(
        canonicalShadowJson({
          extra: true,
          receiptSha256: '0'.repeat(64),
          requiredSetDigest: plan.requiredSetDigest,
          schema: 1,
        }),
      ),
    ]) {
      await storage.write({ kind: 'ready', requiredSetDigest: plan.requiredSetDigest }, bytes);
      const reopened = createOriginExclusiveShadowAssetManager({
        storage,
        source: {
          acquire: async () => {
            throw new Error('valid CAS object should survive pointer repair');
          },
        },
      });
      await expect(reopened.ensure(plan)).resolves.toMatchObject({
        receipt: { requiredSetDigest: plan.requiredSetDigest },
      });
    }
  });

  it('invalidates owned readiness after close', async () => {
    const manager = createOriginExclusiveShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: { acquire: async () => assetBytes },
    });
    const ready = await manager.ensure(plan);
    await manager.close();
    const afterClose = new MessageChannel();
    expect(() => manager.serve(ready, afterClose.port1)).toThrow(/stale or not owned/);
    afterClose.port1.close();
    afterClose.port2.close();
  });

  it('joins concurrent close callers through the same terminal storage outcome', async () => {
    const base = createMemoryShadowAssetStorage();
    const closeEntered = deferred<void>();
    const releaseClose = deferred<void>();
    const closeError = new Error('storage close failed');
    const storage: ShadowAssetStorage = {
      storageClass: base.storageClass,
      read: (entry) => base.read(entry),
      write: (entry, bytes) => base.write(entry, bytes),
      remove: (entry) => base.remove(entry),
      async close() {
        closeEntered.resolve();
        await releaseClose.promise;
        throw closeError;
      },
    };
    const manager = createOriginExclusiveShadowAssetManager({
      storage,
      source: { acquire: async () => assetBytes },
    });

    const first = manager.close();
    await closeEntered.promise;
    const second = manager.close();
    let secondSettled = false;
    void second.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    releaseClose.resolve();
    await expect(first).rejects.toBe(closeError);
    await expect(second).rejects.toBe(closeError);
  });

  it('cold-reopens a corrupt stored object only after honest reacquisition', async () => {
    const storage = createMemoryShadowAssetStorage();
    const first = createOriginExclusiveShadowAssetManager({
      storage,
      source: { acquire: async () => assetBytes },
    });
    await first.ensure(plan);
    await storage.write(
      { kind: 'object', sha256: plan.assets[0]!.memberSha256 },
      new Uint8Array(plan.assets[0]!.memberSize),
    );
    let acquisitions = 0;
    const reopened = createOriginExclusiveShadowAssetManager({
      storage,
      source: {
        acquire: async () => {
          acquisitions += 1;
          return assetBytes;
        },
      },
    });

    await expect(reopened.ensure(plan)).resolves.toMatchObject({
      receipt: { requiredSetDigest: plan.requiredSetDigest },
    });
    expect(acquisitions).toBe(1);
  });

  it('never publishes ready when persistence fails before the commit pointer', async () => {
    const base = createMemoryShadowAssetStorage();
    const writes: ShadowAssetStorageEntry[] = [];
    const storage: ShadowAssetStorage = {
      storageClass: base.storageClass,
      read: (entry) => base.read(entry),
      async write(entry, bytes) {
        writes.push(entry);
        if (entry.kind === 'receipt') throw new Error('quota exceeded');
        await base.write(entry, bytes);
      },
      remove: (entry) => base.remove(entry),
      close: () => base.close(),
    };
    const manager = createOriginExclusiveShadowAssetManager({
      storage,
      source: { acquire: async () => assetBytes },
    });

    await expect(manager.ensure(plan)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'persist',
    });
    expect(writes.map((entry) => entry.kind)).toEqual(['object', 'receipt']);
    await expect(
      base.read({ kind: 'ready', requiredSetDigest: plan.requiredSetDigest }),
    ).resolves.toBeNull();
  });

  it('cancels a stalled acquire through the existing lifecycle abort signal', async () => {
    const started = deferred<void>();
    let observedAbort = false;
    const manager = createOriginExclusiveShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: {
        acquire: async (_asset, signal) => {
          started.resolve();
          return await new Promise<Uint8Array>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                observedAbort = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
      },
    });
    const ensuring = manager.ensure(plan);
    await started.promise;
    const closing = manager.close();
    await expect(ensuring).rejects.toMatchObject({ code: 'ESHADOWASSET' });
    await closing;
    expect(observedAbort).toBe(true);
  });

  it('serves retained verified bytes without rereading or reacquiring the backing object', async () => {
    const base = createMemoryShadowAssetStorage();
    let objectReads = 0;
    const storage: ShadowAssetStorage = {
      storageClass: base.storageClass,
      async read(entry) {
        if (entry.kind === 'object') objectReads += 1;
        return await base.read(entry);
      },
      write: (entry, bytes) => base.write(entry, bytes),
      remove: (entry) => base.remove(entry),
      close: () => base.close(),
    };
    let acquisitions = 0;
    const manager = createOriginExclusiveShadowAssetManager({
      storage,
      source: {
        acquire: async () => {
          acquisitions += 1;
          return assetBytes;
        },
      },
    });
    const ready = await manager.ensure(plan);
    const readsAfterEnsure = objectReads;
    await base.remove({ kind: 'object', sha256: plan.assets[0]!.memberSha256 });
    await base.remove({ kind: 'receipt', sha256: ready.receipt.receiptSha256 });
    await base.remove({ kind: 'ready', requiredSetDigest: plan.requiredSetDigest });

    const channel = new MessageChannel();
    const server = manager.serve(ready, channel.port1);
    const client = createShadowAssetPortClient(channel.port2, { deadlineMs: 1_000 });
    await client.ready;

    const first = await client.read(plan.assets[0]!.id);
    const second = await client.read(plan.assets[0]!.id);
    expect(shadowSha256(first)).toBe(plan.assets[0]!.memberSha256);
    expect(shadowSha256(second)).toBe(plan.assets[0]!.memberSha256);
    expect(objectReads).toBe(readsAfterEnsure);
    expect(acquisitions).toBe(1);
    client.dispose();
    server.dispose();
    await manager.close();
  });

  it('persists through a VFS store and reports OPFS durability honestly', async () => {
    const vfs = new MemoryVfs();
    let flushes = 0;
    const durability = {
      persistedVfs: vfs,
      flush: async () => {
        flushes += 1;
        return { failures: [], total: 0 };
      },
    };
    const first = createVfsShadowAssetStorage(vfs, 'opfs-best-effort', durability);
    const entry = { kind: 'object' as const, sha256: 'a'.repeat(64) };
    await first.write(entry, new Uint8Array([1, 2, 3]));
    expect(flushes).toBe(1);
    const reopened = createVfsShadowAssetStorage(vfs, 'opfs-best-effort', durability);
    await expect(reopened.read(entry)).resolves.toEqual(new Uint8Array([1, 2, 3]));

    await expect(probeBrowserShadowAssetStorageClass(false, undefined)).resolves.toBe(
      'memory-session',
    );
    await expect(probeBrowserShadowAssetStorageClass(true, undefined)).resolves.toBe(
      'opfs-best-effort',
    );
    await expect(
      probeBrowserShadowAssetStorageClass(true, {
        persisted: async () => true,
        persist: async () => false,
      }),
    ).resolves.toBe('opfs-persisted');
    await expect(
      probeBrowserShadowAssetStorageClass(true, {
        persisted: async () => false,
        persist: async () => true,
      }),
    ).resolves.toBe('opfs-persisted');
    await expect(
      probeBrowserShadowAssetStorageClass(true, {
        persisted: async () => false,
        persist: async () => false,
      }),
    ).resolves.toBe('opfs-best-effort');
    await expect(
      probeBrowserShadowAssetStorageClass(true, {
        persisted: async () => {
          throw new Error('storage manager unavailable');
        },
        persist: async () => {
          throw new Error('storage manager unavailable');
        },
      }),
    ).resolves.toBe('opfs-best-effort');
  });

  it('rejects a nonthrowing OPFS failure report before claiming remove durability', async () => {
    const vfs = new MemoryVfs();
    let failPersistence = false;
    const entry = { kind: 'object' as const, sha256: 'a'.repeat(64) };
    const storage = createVfsShadowAssetStorage(vfs, 'opfs-persisted', {
      persistedVfs: vfs,
      flush: async () =>
        failPersistence
          ? {
              failures: [
                {
                  path: `/.rifty/shadow-assets/v1/object/${entry.sha256}`,
                  op: 'rm' as const,
                  message: 'QuotaExceededError',
                },
              ],
              total: 1,
            }
          : { failures: [], total: 0 },
    });
    await storage.write(entry, new Uint8Array([1, 2, 3]));
    failPersistence = true;

    await expect(storage.remove(entry)).rejects.toThrow(
      'shadow VFS remove has 1 unhealed persistence failure(s)',
    );
  });

  it.each(['quota', 'torn-object'] as const)(
    'does not publish a receipt or ready pointer after a %s persistence fault',
    async (fault) => {
      const persisted = new MemoryVfs();
      const mutationVfs =
        fault === 'quota'
          ? adaptVfs(persisted, {
              writeFile: async (path, data) => {
                if (path.includes('/object/')) throw new Error('quota exceeded');
                await persisted.writeFile(path, data);
              },
            })
          : persisted;
      const persistedVfs =
        fault === 'torn-object'
          ? adaptVfs(persisted, {
              readFile: async (path) =>
                path.includes('/object/') ? new Uint8Array([0]) : await persisted.readFile(path),
            })
          : persisted;
      const manager = createOriginExclusiveShadowAssetManager({
        storage: createVfsShadowAssetStorage(mutationVfs, 'opfs-persisted', {
          persistedVfs,
          flush: async () => ({ failures: [], total: 0 }),
        }),
        source: { acquire: async () => assetBytes },
      });

      await expect(manager.ensure(plan)).rejects.toMatchObject({
        code: 'ESHADOWASSET',
        phase: 'persist',
      });
      await expect(persisted.exists('/.rifty/shadow-assets/v1/receipt')).resolves.toBe(false);
      await expect(
        persisted.exists(`/.rifty/shadow-assets/v1/ready/${plan.requiredSetDigest}`),
      ).resolves.toBe(false);
    },
  );

  it('rolls back a torn ready pointer after persisted-surface read-back disagrees', async () => {
    const persisted = new MemoryVfs();
    const persistedVfs = adaptVfs(persisted, {
      readFile: async (path) =>
        path.includes('/ready/') ? new Uint8Array([0]) : await persisted.readFile(path),
    });
    const manager = createOriginExclusiveShadowAssetManager({
      storage: createVfsShadowAssetStorage(persisted, 'opfs-persisted', {
        persistedVfs,
        flush: async () => ({ failures: [], total: 0 }),
      }),
      source: { acquire: async () => assetBytes },
    });

    await expect(manager.ensure(plan)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'persist',
    });
    await expect(
      persisted.exists(`/.rifty/shadow-assets/v1/ready/${plan.requiredSetDigest}`),
    ).resolves.toBe(false);
  });
});
