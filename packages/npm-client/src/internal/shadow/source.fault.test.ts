import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { ShadowRuntimeAsset } from '@riftydev/shadow-registry/internal';
import { describe, expect, it } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from '../../_test-fixtures/tar-builder.ts';
import { RegistryClient } from '../../registry.ts';
import {
  ShadowAssetError,
  type ShadowAssetStorage,
  type ShadowAssetStorageEntry,
  createMemoryShadowAssetStorage,
  createOriginExclusiveShadowAssetManager,
} from './manager.ts';
import { attestBuiltinShadowSubstitution, planAppliedShadowSubstitutions } from './planner.ts';
import { createRegistryShadowAssetSource } from './source.ts';

const plan = planAppliedShadowSubstitutions([
  attestBuiltinShadowSubstitution({
    trigger: { name: 'esbuild', requestedRange: '0.28.0', version: '0.28.0' },
    installPath: 'node_modules/esbuild',
    acquisition: { kind: 'synthetic' },
  }),
]);
const asset = plan.assets[0];
if (asset === undefined) throw new Error('esbuild fault fixture has no runtime asset');

const requireFromRegistry = createRequire(
  new URL('../../../../../tools/shadow-registry/package.json', import.meta.url),
);
const assetBytes = new Uint8Array(
  await readFile(requireFromRegistry.resolve('esbuild-wasm/esbuild.wasm')),
);
const wrongSriTarball = await gzip(
  concat(buildHeader(asset.member, assetBytes.byteLength), padToBlock(assetBytes), TAR_TRAILER),
);
if (wrongSriTarball.byteLength > asset.maxTarballBytes) {
  throw new Error('wrong-SRI tarball fixture exceeds the admitted compressed cap');
}

function exactPackument(runtimeAsset: Readonly<ShadowRuntimeAsset>) {
  return {
    name: runtimeAsset.source.name,
    versions: {
      [runtimeAsset.source.version]: {
        name: runtimeAsset.source.name,
        version: runtimeAsset.source.version,
        dist: {
          tarball: `https://registry.test/${runtimeAsset.source.name}.tgz`,
          integrity: runtimeAsset.source.integrity,
        },
      },
    },
  };
}

function recordingStorage(): {
  readonly storage: ShadowAssetStorage;
  readonly writes: ShadowAssetStorageEntry[];
} {
  const base = createMemoryShadowAssetStorage();
  const writes: ShadowAssetStorageEntry[] = [];
  const storage: ShadowAssetStorage = Object.freeze({
    storageClass: base.storageClass,
    read: (entry: ShadowAssetStorageEntry) => base.read(entry),
    write: async (entry: ShadowAssetStorageEntry, bytes: Uint8Array) => {
      writes.push(entry);
      await base.write(entry, bytes);
    },
    remove: (entry: ShadowAssetStorageEntry) => base.remove(entry),
    close: () => base.close(),
  });
  return {
    writes,
    storage,
  };
}

async function rejected(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('fault operation unexpectedly succeeded');
}

async function settleWithin<T>(operation: Promise<T>, timeoutMs = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`fault operation did not settle within ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe('registry shadow asset source faults', () => {
  it('rejects an under-cap wrong-SRI tarball before publication and retries cleanly', async () => {
    const registrySource = createRegistryShadowAssetSource(
      new RegistryClient({
        baseUrl: 'https://registry.test',
        maxRetries: 0,
        fetch: async (url) =>
          String(url).endsWith(`/${asset.source.name}`)
            ? new Response(JSON.stringify(exactPackument(asset)))
            : new Response(wrongSriTarball as unknown as BodyInit),
      }),
    );
    let networkRestored = false;
    const h = recordingStorage();
    const manager = createOriginExclusiveShadowAssetManager({
      storage: h.storage,
      source: {
        acquire: (requested, signal) =>
          networkRestored
            ? Promise.resolve(assetBytes.slice())
            : registrySource.acquire(requested, signal),
      },
    });

    const failure = await rejected(manager.ensure(plan));

    expect(failure).toBeInstanceOf(ShadowAssetError);
    expect(failure).toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'acquire',
      message: `failed to acquire ${asset.id}`,
    });
    expect((failure as Error).cause).toMatchObject({
      message: `shadow asset source integrity mismatch for ${asset.id}`,
    });
    expect(h.writes).toEqual([]);

    networkRestored = true;
    await expect(manager.ensure(plan)).resolves.toMatchObject({
      receipt: { requiredSetDigest: plan.requiredSetDigest },
    });
    expect(h.writes.map((entry) => entry.kind)).toEqual(['object', 'receipt', 'ready']);
    await manager.close();
  });

  it('settles cold fully-offline empty storage with an actionable asset error and retries online', async () => {
    const registrySource = createRegistryShadowAssetSource(
      new RegistryClient({
        baseUrl: 'https://registry.test',
        maxRetries: 0,
        fetch: async () => {
          throw new TypeError('network unavailable while fully offline');
        },
      }),
    );
    let networkRestored = false;
    const h = recordingStorage();
    const manager = createOriginExclusiveShadowAssetManager({
      storage: h.storage,
      source: {
        acquire: (requested, signal) =>
          networkRestored
            ? Promise.resolve(assetBytes.slice())
            : registrySource.acquire(requested, signal),
      },
    });

    const failure = await rejected(settleWithin(manager.ensure(plan)));

    expect(failure).toBeInstanceOf(ShadowAssetError);
    expect(failure).toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'acquire',
      message: `failed to acquire ${asset.id}`,
    });
    expect((failure as Error).cause).toMatchObject({
      message: expect.stringContaining('network unavailable while fully offline'),
    });
    expect(h.writes).toEqual([]);

    networkRestored = true;
    await expect(manager.ensure(plan)).resolves.toMatchObject({
      receipt: { requiredSetDigest: plan.requiredSetDigest },
    });
    expect(h.writes.map((entry) => entry.kind)).toEqual(['object', 'receipt', 'ready']);
    await manager.close();
  });
});
