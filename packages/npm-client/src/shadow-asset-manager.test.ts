import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { canonicalShadowDigest } from './canonical-shadow-json.ts';
import type { InstallTreeResult } from './installer.ts';
import { RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL } from './linker.ts';
import { RegistryClient } from './registry.ts';
import type { LockfileAppliedShadowSubstitution } from './shadow-asset-lockfile-trace.ts';
import {
  EMPTY_SHADOW_ASSET_PLAN,
  appliedBuiltinShadowSubstitution,
  planBuiltinShadowAssets,
} from './shadow-asset-plan.ts';
import {
  ShadowAssetError,
  ShadowAssetInstallError,
  type ShadowAssetPlan,
  ShadowAssetReadError,
  type ShadowAssetReadOptions,
  type ShadowAssetSource,
  type ShadowAssetSourceRequest,
  type ShadowAssetStorage,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
  createStandardShadowAssetSource,
} from './shadow-assets.ts';
import { VfsTarballCache } from './tarball-cache.ts';

const encoder = new TextEncoder();

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sri(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function tar(entries: readonly { name: string; bytes: Uint8Array; type?: string }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(512);
    header.set(encoder.encode(entry.name), 0);
    header.set(encoder.encode(entry.bytes.byteLength.toString(8).padStart(11, '0')), 124);
    header[135] = 0;
    header[156] = (entry.type ?? '0').charCodeAt(0);
    chunks.push(header, entry.bytes, new Uint8Array((512 - (entry.bytes.byteLength % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function fixture(
  entries: readonly { name: string; bytes: Uint8Array; type?: string }[] = [
    { name: 'package/runtime.wasm', bytes: encoder.encode('runtime') },
  ],
) {
  const unpacked = tar(entries);
  const tgz = new Uint8Array(gzipSync(unpacked));
  const member =
    entries.find((entry) => entry.name === 'package/runtime.wasm' && (entry.type ?? '0') === '0')
      ?.bytes ??
    entries[0]?.bytes ??
    new Uint8Array();
  const substitutions: ShadowAssetPlan['substitutions'] = [
    {
      catalog: { id: 'test.catalog', digest: '2'.repeat(64) },
      publicName: 'native-tool',
      requestedRange: '^1',
      resolvedPublicVersion: '1.0.0',
      substitutionId: 'test.substitution',
      runtimeAdapterId: 'test.adapter',
      builtin: true,
    },
  ];
  const assets: ShadowAssetPlan['assets'] = [
    {
      id: 'runtime',
      source: { name: 'runtime-source', version: '1.0.0', integrity: sri(tgz) },
      member: 'package/runtime.wasm',
      memberSha256: sha256(member),
      memberSize: member.byteLength,
      maxTarballBytes: tgz.byteLength,
      maxUnpackedBytes: unpacked.byteLength,
    },
  ];
  const plan: ShadowAssetPlan = {
    requiredSetDigest: canonicalShadowDigest({ schema: 1, substitutions, assets }),
    substitutions,
    assets,
  };
  return { member, plan, tgz };
}

function siblingPlan(plan: ShadowAssetPlan, requestedRange: string): ShadowAssetPlan {
  const substitutions = plan.substitutions.map((substitution) => ({
    ...substitution,
    requestedRange,
  }));
  return {
    requiredSetDigest: canonicalShadowDigest({ schema: 1, substitutions, assets: plan.assets }),
    substitutions,
    assets: plan.assets,
  };
}

function source(bytes: Uint8Array): ShadowAssetSource & { acquire: ReturnType<typeof vi.fn> } {
  return {
    acquire: vi.fn(async (requests) =>
      requests.map((request: ShadowAssetSourceRequest) => ({
        request,
        bytes: bytes.slice(),
        fillTransport: 'standard' as const,
        fillCache: 'network' as const,
      })),
    ),
    close: vi.fn(async () => undefined),
  };
}

describe('ShadowAssetManager', () => {
  it('requires exact post-tree evidence and snapshots it at ShadowAssetInstallError construction', () => {
    const plan = structuredClone(EMPTY_SHADOW_ASSET_PLAN);
    const failure = {
      message: 'asset persistence failed',
      requiredSetDigest: plan.requiredSetDigest,
      phase: 'persist' as const,
      transports: [],
      recovery: 'clear-and-retry' as const,
    };
    expect(() => new ShadowAssetInstallError({} as InstallTreeResult, plan, failure)).toThrowError(
      TypeError,
    );

    const treeResult: InstallTreeResult = {
      packages: [],
      lockfile: {
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {},
      },
      conflicts: [],
      provenance: { resolution: 'metadata', packages: [] },
      source: 'standard',
    };
    const error = new ShadowAssetInstallError(treeResult, plan, failure);
    treeResult.packages.push({
      name: 'late-mutation',
      version: '1.0.0',
      files: {},
      dependencies: {},
    });
    treeResult.lockfile.name = 'mutated';
    (plan.substitutions as unknown as unknown[]).push({});

    expect(error.treeResult.packages).toEqual([]);
    expect(error.treeResult.lockfile.name).toBe('root');
    expect(error.plan.substitutions).toEqual([]);
    expect(Object.isFrozen(error.treeResult)).toBe(true);
    expect(Object.isFrozen(error.treeResult.lockfile)).toBe(true);
    expect(Object.isFrozen(error.plan)).toBe(true);
  });

  it('rejects post-tree failure evidence that belongs to another plan', () => {
    const { plan } = fixture();
    const treeResult: InstallTreeResult = {
      packages: [],
      lockfile: {
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {},
      },
      conflicts: [],
      provenance: { resolution: 'metadata', packages: [] },
    };
    const base = {
      message: 'asset persistence failed',
      requiredSetDigest: plan.requiredSetDigest,
      phase: 'persist' as const,
      transports: [],
      recovery: 'clear-and-retry' as const,
    };

    expect(
      () =>
        new ShadowAssetInstallError(treeResult, plan, {
          ...base,
          requiredSetDigest: 'f'.repeat(64),
        }),
    ).toThrowError(TypeError);
    expect(
      () =>
        new ShadowAssetInstallError(treeResult, plan, {
          ...base,
          assetId: 'foreign-runtime',
        }),
    ).toThrowError(TypeError);
  });

  it('rejects post-tree evidence whose lockfile trace and plan disagree', () => {
    const applied = appliedBuiltinShadowSubstitution('esbuild', '^0.28.0', '0.28.0');
    if (applied === null) throw new Error('fixture expected the builtin esbuild substitution');
    const required = planBuiltinShadowAssets([applied]);
    const requiredTrace: readonly LockfileAppliedShadowSubstitution[] = [
      {
        publicName: applied.publicName,
        requestedRange: applied.requestedRange,
        resolvedPublicVersion: applied.resolvedPublicVersion,
        runtimeAdapterId: applied.runtimeAdapterId,
        substitutionId: applied.substitutionId,
      },
    ];
    const treeResult = (
      trace: readonly LockfileAppliedShadowSubstitution[],
    ): InstallTreeResult => ({
      packages: [],
      lockfile: {
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          'node_modules/@esbuild/wasi-preview1': {
            version: '0.28.0',
            dependencies: {},
          },
        },
        rifty: {
          shadowSubstitutions: {
            protocol: RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL,
            applied: trace,
          },
        },
      },
      conflicts: [],
      provenance: { resolution: 'metadata', packages: [] },
    });
    const failure = (plan: ShadowAssetPlan) => ({
      message: 'asset persistence failed',
      requiredSetDigest: plan.requiredSetDigest,
      phase: 'persist' as const,
      transports: [],
      recovery: 'clear-and-retry' as const,
    });

    expect(() => new ShadowAssetInstallError(treeResult([]), required, failure(required))).toThrow(
      /lockfile trace.*plan/i,
    );
    expect(
      () =>
        new ShadowAssetInstallError(
          treeResult(requiredTrace),
          EMPTY_SHADOW_ASSET_PLAN,
          failure(EMPTY_SHADOW_ASSET_PLAN),
        ),
    ).toThrow(/lockfile trace.*plan/i);
    expect(
      () =>
        new ShadowAssetInstallError(
          treeResult([...requiredTrace, ...requiredTrace]),
          required,
          failure(required),
        ),
    ).toThrow(/canonical/i);
  });

  it.each([
    ['missing', {}],
    [
      'wrong-version',
      { 'node_modules/@esbuild/wasi-preview1': { version: '0.28.1', dependencies: {} } },
    ],
  ])('rejects post-tree evidence with a %s materialized recipe target', (_label, packages) => {
    const applied = appliedBuiltinShadowSubstitution('esbuild', '^0.28.0', '0.28.0');
    if (applied === null) throw new Error('fixture expected the builtin esbuild substitution');
    const plan = planBuiltinShadowAssets([applied]);
    const treeResult: InstallTreeResult = {
      packages: [],
      lockfile: {
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages,
        rifty: {
          shadowSubstitutions: {
            protocol: RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL,
            applied: [
              {
                publicName: applied.publicName,
                requestedRange: applied.requestedRange,
                resolvedPublicVersion: applied.resolvedPublicVersion,
                runtimeAdapterId: applied.runtimeAdapterId,
                substitutionId: applied.substitutionId,
              },
            ],
          },
        },
      },
      conflicts: [],
      provenance: { resolution: 'metadata', packages: [] },
    };

    expect(
      () =>
        new ShadowAssetInstallError(treeResult, plan, {
          message: 'asset persistence failed',
          requiredSetDigest: plan.requiredSetDigest,
          phase: 'persist',
          transports: [],
          recovery: 'clear-and-retry',
        }),
    ).toThrow(/materialized.*target/i);
  });

  it('joins the real STD RegistryClient/tarball-cache adapter to MemoryVfs readiness', async () => {
    const { member, plan, tgz } = fixture();
    const network = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === '/registry/runtime-source') {
        return new Response(
          JSON.stringify({
            name: 'runtime-source',
            versions: {
              '1.0.0': {
                name: 'runtime-source',
                version: '1.0.0',
                dist: {
                  tarball: '/runtime-source.tgz',
                  integrity: plan.assets[0]!.source.integrity,
                },
              },
            },
          }),
        );
      }
      if (href === '/runtime-source.tgz') return new Response(tgz);
      return new Response(null, { status: 404 });
    });
    const registry = new RegistryClient({ baseUrl: '/registry', fetch: network, maxRetries: 0 });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: createStandardShadowAssetSource({
        registry,
        tarballCache: new VfsTarballCache(new MemoryVfs()),
      }),
    });
    await expect(manager.installer.ensure(plan)).resolves.toMatchObject({ kind: 'ready' });
    expect(await manager.runtimeReader(plan).readVerified('runtime')).toEqual(member);
    await manager.installer.ensure(plan);
    expect(
      network.mock.calls.filter(([url]) => String(url) === '/runtime-source.tgz'),
    ).toHaveLength(1);

    await manager.admin.clearCache();
    await expect(manager.installer.ensure(plan)).resolves.toMatchObject({ kind: 'ready' });
    expect(await manager.runtimeReader(plan).readVerified('runtime')).toEqual(member);
    expect(
      network.mock.calls.filter(([url]) => String(url) === '/runtime-source.tgz'),
    ).toHaveLength(1);
    expect(
      network.mock.calls.filter(([url]) => String(url) === '/registry/runtime-source'),
    ).toHaveLength(1);
  });

  it('returns canonical not-required without admitting source work', async () => {
    const assetSource = source(new Uint8Array());
    const substitutions: ShadowAssetPlan['substitutions'] = [];
    const assets: ShadowAssetPlan['assets'] = [];
    const plan: ShadowAssetPlan = {
      requiredSetDigest: canonicalShadowDigest({ schema: 1, substitutions, assets }),
      substitutions,
      assets,
    };
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: assetSource,
    });

    await expect(manager.installer.ensure(plan)).resolves.toEqual({ kind: 'not-required', plan });
    expect(assetSource.acquire).not.toHaveBeenCalled();
  });

  it('rejects malformed canonical SRI before storage or source work', async () => {
    const { plan, tgz } = fixture();
    const assets = plan.assets.map((asset) => ({
      ...asset,
      source: { ...asset.source, integrity: 'sha512-not-base64' },
    }));
    const corrupt: ShadowAssetPlan = {
      requiredSetDigest: canonicalShadowDigest({
        schema: 1,
        substitutions: plan.substitutions,
        assets,
      }),
      substitutions: plan.substitutions,
      assets,
    };
    const storage = createMemoryShadowAssetStorage();
    const read = vi.spyOn(storage, 'read');
    const write = vi.spyOn(storage, 'write');
    const assetSource = source(tgz);
    const manager = createShadowAssetManager({ storage, source: assetSource });

    await expect(manager.installer.ensure(corrupt)).rejects.toBeInstanceOf(TypeError);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(assetSource.acquire).not.toHaveBeenCalled();
  });

  it('MemoryVfs storage snapshots writes, owns reads, and reports semantic usage', async () => {
    const storage = createMemoryShadowAssetStorage();
    const entry = { kind: 'object' as const, sha256: 'a'.repeat(64) };
    const input = new Uint8Array([1, 2, 3]);
    await storage.write(entry, input);
    input[0] = 9;
    const first = await storage.read(entry);
    expect(first).toEqual(new Uint8Array([1, 2, 3]));
    first![1] = 9;
    expect(await storage.read(entry)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await storage.inspect()).toEqual({
      entryCount: 1,
      storedBytes: 3,
      entries: [{ entry, byteLength: 3 }],
    });
  });

  it.each(['.', '..'])(
    'round-trips opaque temp id %s without exposing path grammar',
    async (id) => {
      const storage = createMemoryShadowAssetStorage();
      const entry = { kind: 'temp' as const, id };
      const bytes = new Uint8Array([1, 2, 3]);

      await storage.write(entry, bytes);
      expect(await storage.read(entry)).toEqual(bytes);
      expect(await storage.inspect()).toMatchObject({
        entryCount: 1,
        storedBytes: bytes.byteLength,
        entries: [{ entry, byteLength: bytes.byteLength }],
      });
      await storage.remove(entry);
      expect(await storage.read(entry)).toBeNull();
    },
  );

  it('publishes a verified receipt, serves owned bytes, and re-verifies a hit without source I/O', async () => {
    const { member, plan, tgz } = fixture();
    const assetSource = source(tgz);
    const storage = createMemoryShadowAssetStorage();
    const manager = createShadowAssetManager({
      storage,
      source: assetSource,
    });

    const first = await manager.installer.ensure(plan);
    expect(first.kind).toBe('ready');
    if (first.kind !== 'ready') throw new Error('expected ready');
    expect(first.receipt.assets[0]).toMatchObject({
      id: 'runtime',
      fillTransport: 'standard',
      fillCache: 'network',
    });
    expect(first.receipt.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    const storedReceipt = await storage.read({
      kind: 'receipt',
      sha256: first.receipt.receiptSha256,
    });
    expect(storedReceipt).not.toBeNull();
    expect(sha256(storedReceipt!)).toBe(first.receipt.receiptSha256);
    expect(JSON.parse(new TextDecoder().decode(storedReceipt!))).not.toHaveProperty(
      'receiptSha256',
    );
    expect(await manager.runtimeReader(plan).readVerified('runtime')).toEqual(member);

    const second = await manager.installer.ensure(plan);
    expect(second).toEqual(first);
    expect(assetSource.acquire).toHaveBeenCalledTimes(1);
    await manager.close();
  });

  it('single-flights concurrent writers for the same required set', async () => {
    const { plan, tgz } = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const assetSource = source(tgz);
    assetSource.acquire.mockImplementationOnce(async (requests) => {
      await gate;
      return requests.map((request: ShadowAssetSourceRequest) => ({
        request,
        bytes: tgz.slice(),
        fillTransport: 'standard' as const,
        fillCache: 'network' as const,
      }));
    });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: assetSource,
    });
    const left = manager.installer.ensure(plan);
    const right = manager.installer.ensure(plan);
    release();
    await expect(Promise.all([left, right])).resolves.toHaveLength(2);
    expect(assetSource.acquire).toHaveBeenCalledTimes(1);
  });

  it('performs zero work for an already-aborted sole ensure', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    const read = vi.fn((entry: Parameters<ShadowAssetStorage['read']>[0]) => inner.read(entry));
    const write = vi.fn((entry: Parameters<ShadowAssetStorage['write']>[0], bytes: Uint8Array) =>
      inner.write(entry, bytes),
    );
    const assetSource = source(tgz);
    const manager = createShadowAssetManager({
      storage: { ...inner, read, write },
      source: assetSource,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      manager.installer.ensure(plan, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(assetSource.acquire).not.toHaveBeenCalled();
  });

  it('aborts a sole producer when its only waiter cancels and never publishes readiness', async () => {
    const { plan } = fixture();
    let producerSignal: AbortSignal | undefined;
    let admitted!: () => void;
    const started = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const acquire = vi.fn(
      async (
        _requests: readonly ShadowAssetSourceRequest[],
        options: Readonly<{ signal: AbortSignal }>,
      ): Promise<never> => {
        producerSignal = options.signal;
        admitted();
        await new Promise<never>((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted', 'AbortError')),
            { once: true },
          );
        });
        throw new Error('unreachable');
      },
    );
    const storage = createMemoryShadowAssetStorage();
    const write = vi.spyOn(storage, 'write');
    const manager = createShadowAssetManager({
      storage,
      source: { acquire, close: async () => undefined },
    });
    const controller = new AbortController();
    const ensuring = manager.installer.ensure(plan, { signal: controller.signal });
    void ensuring.catch(() => undefined);
    await started;
    controller.abort();

    await expect(ensuring).rejects.toMatchObject({ name: 'AbortError' });
    expect(producerSignal?.aborted).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
  });

  it.each(['clear', 'close'] as const)(
    'awaits a detached cancelled producer before %s mutates the manager lifetime',
    async (operation) => {
      const { plan } = fixture();
      const events: string[] = [];
      let admitted!: () => void;
      const started = new Promise<void>((resolve) => {
        admitted = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const acquire = vi.fn(async (): Promise<never> => {
        admitted();
        await gate;
        events.push('acquire-settled');
        throw new Error('cancelled producer settled late');
      });
      const inner = createMemoryShadowAssetStorage();
      const write = vi.spyOn(inner, 'write');
      const storage: ShadowAssetStorage = {
        storageClass: inner.storageClass,
        read: (entry) => inner.read(entry),
        write: (entry, bytes) => inner.write(entry, bytes),
        remove: (entry) => inner.remove(entry),
        inspect: () => inner.inspect(),
        clear: async () => {
          events.push('storage-clear');
          await inner.clear();
        },
        close: async () => {
          events.push('storage-close');
          await inner.close();
        },
      };
      const manager = createShadowAssetManager({
        storage,
        source: {
          acquire,
          close: async () => {
            events.push('source-close');
          },
        },
      });
      const controller = new AbortController();
      const ensuring = manager.installer.ensure(plan, { signal: controller.signal });
      void ensuring.catch(() => undefined);
      await started;
      controller.abort();
      await expect(ensuring).rejects.toMatchObject({ name: 'AbortError' });

      const lifetime =
        operation === 'clear' ? manager.admin.clearCache().then(() => undefined) : manager.close();
      void lifetime.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
      expect(events).toEqual([]);

      release();
      await expect(lifetime).resolves.toBeUndefined();
      expect(events).toEqual(
        operation === 'clear'
          ? ['acquire-settled', 'storage-clear']
          : ['acquire-settled', 'source-close', 'storage-close'],
      );
      expect(write).not.toHaveBeenCalled();
    },
  );

  it('starts a fresh object producer when retry follows a sole-cancelled flight', async () => {
    const { plan, tgz } = fixture();
    let admitted!: () => void;
    const started = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    let settleCancelledProducer!: () => void;
    const cancelledProducer = new Promise<never>((_resolve, reject) => {
      settleCancelledProducer = () => reject(new Error('cancelled producer settled late'));
    });
    let acquireCalls = 0;
    const acquire = vi.fn(async (requests: readonly ShadowAssetSourceRequest[]) => {
      acquireCalls += 1;
      if (acquireCalls === 1) {
        admitted();
        return await cancelledProducer;
      }
      return requests.map((request) => ({
        request,
        bytes: tgz.slice(),
        fillTransport: 'standard' as const,
        fillCache: 'network' as const,
      }));
    });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: { acquire, close: async () => undefined },
    });
    const controller = new AbortController();
    const cancelled = manager.installer.ensure(plan, { signal: controller.signal });
    void cancelled.catch(() => undefined);
    await started;
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    const retry = manager.installer.ensure(plan);
    void retry.catch(() => undefined);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(acquire).toHaveBeenCalledTimes(2);
      await expect(retry).resolves.toMatchObject({ kind: 'ready' });
    } finally {
      settleCancelledProducer();
    }
  });

  it('single-flights the same missing object across different required-set receipts', async () => {
    const { plan, tgz } = fixture();
    const substitutions = plan.substitutions.map((substitution) => ({
      ...substitution,
      requestedRange: '1.0.0',
    }));
    const sibling: ShadowAssetPlan = {
      requiredSetDigest: canonicalShadowDigest({
        schema: 1,
        substitutions,
        assets: plan.assets,
      }),
      substitutions,
      assets: plan.assets,
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const assetSource = source(tgz);
    assetSource.acquire.mockImplementationOnce(async (requests) => {
      await gate;
      return requests.map((request: ShadowAssetSourceRequest) => ({
        request,
        bytes: tgz.slice(),
        fillTransport: 'standard' as const,
        fillCache: 'network' as const,
      }));
    });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: assetSource,
    });
    const first = manager.installer.ensure(plan);
    const second = manager.installer.ensure(sibling);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(assetSource.acquire).toHaveBeenCalledTimes(1);
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).not.toBeNull();
    expect(await manager.installer.inspectReceipt(sibling.requiredSetDigest)).not.toBeNull();
  });

  it('verifies every member contract before sharing one content-hash object', async () => {
    const { plan, tgz } = fixture();
    const descriptor = plan.assets[0]!;
    const assets: ShadowAssetPlan['assets'] = [
      { ...descriptor, id: 'runtime-a' },
      { ...descriptor, id: 'runtime-b', member: 'package/missing.wasm' },
    ];
    const conflicting: ShadowAssetPlan = {
      requiredSetDigest: canonicalShadowDigest({
        schema: 1,
        substitutions: plan.substitutions,
        assets,
      }),
      substitutions: plan.substitutions,
      assets,
    };
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(tgz),
    });

    await expect(manager.installer.ensure(conflicting)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'verify',
    });
    expect(await manager.installer.inspectReceipt(conflicting.requiredSetDigest)).toBeNull();
    expect(await manager.admin.inspectUsage()).toMatchObject({ readySetCount: 0 });
  });

  it('does not reuse warm provenance for a different member contract with the same object hash', async () => {
    const { plan, tgz } = fixture();
    const assetSource = source(tgz);
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: assetSource,
    });
    await manager.installer.ensure(plan);
    const assets: ShadowAssetPlan['assets'] = [
      { ...plan.assets[0]!, member: 'package/missing.wasm' },
    ];
    const missingMember: ShadowAssetPlan = {
      requiredSetDigest: canonicalShadowDigest({
        schema: 1,
        substitutions: plan.substitutions,
        assets,
      }),
      substitutions: plan.substitutions,
      assets,
    };

    await expect(manager.installer.ensure(missingMember)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      assetId: 'runtime',
      phase: 'verify',
    });
    expect(await manager.installer.inspectReceipt(missingMember.requiredSetDigest)).toBeNull();
    expect(assetSource.acquire).toHaveBeenCalledTimes(2);
  });

  it('preserves per-descriptor fill provenance for cap-distinct contracts sharing one hash', async () => {
    const { plan, tgz } = fixture();
    const descriptor = plan.assets[0]!;
    const assets: ShadowAssetPlan['assets'] = [
      { ...descriptor, id: 'runtime-a' },
      { ...descriptor, id: 'runtime-b', maxTarballBytes: descriptor.maxTarballBytes + 1 },
    ];
    const capDistinct: ShadowAssetPlan = {
      requiredSetDigest: canonicalShadowDigest({
        schema: 1,
        substitutions: plan.substitutions,
        assets,
      }),
      substitutions: plan.substitutions,
      assets,
    };
    const acquire = vi.fn(async (requests: readonly ShadowAssetSourceRequest[]) =>
      requests.map((request) => ({
        request,
        bytes: tgz.slice(),
        fillTransport: 'standard' as const,
        fillCache:
          request.maxTarballBytes === descriptor.maxTarballBytes
            ? ('network' as const)
            : ('tarball' as const),
      })),
    );
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: { acquire, close: async () => undefined },
    });

    const result = await manager.installer.ensure(capDistinct);
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('expected ready');
    expect(result.receipt.assets.map(({ id, fillCache }) => ({ id, fillCache }))).toEqual([
      { id: 'runtime-a', fillCache: 'network' },
      { id: 'runtime-b', fillCache: 'tarball' },
    ]);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('publishes one hash-keyed object across concurrent cap-distinct sets', async () => {
    const { plan, tgz } = fixture();
    const descriptor = plan.assets[0]!;
    const siblingAssets: ShadowAssetPlan['assets'] = [
      { ...descriptor, maxTarballBytes: descriptor.maxTarballBytes + 1 },
    ];
    const sibling: ShadowAssetPlan = {
      requiredSetDigest: canonicalShadowDigest({
        schema: 1,
        substitutions: plan.substitutions,
        assets: siblingAssets,
      }),
      substitutions: plan.substitutions,
      assets: siblingAssets,
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let admitted!: () => void;
    const bothAdmitted = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    let acquisitions = 0;
    const acquire = vi.fn(async (requests: readonly ShadowAssetSourceRequest[]) => {
      acquisitions += 1;
      if (acquisitions === 2) admitted();
      await gate;
      return requests.map((request) => ({
        request,
        bytes: tgz.slice(),
        fillTransport: 'standard' as const,
        fillCache:
          request.maxTarballBytes === descriptor.maxTarballBytes
            ? ('network' as const)
            : ('tarball' as const),
      }));
    });
    const inner = createMemoryShadowAssetStorage();
    let objectWrites = 0;
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) => inner.read(entry),
      write: async (entry, bytes) => {
        if (entry.kind === 'object') objectWrites += 1;
        await inner.write(entry, bytes);
      },
      remove: (entry) => inner.remove(entry),
      inspect: () => inner.inspect(),
      clear: () => inner.clear(),
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({
      storage,
      source: { acquire, close: async () => undefined },
    });

    const first = manager.installer.ensure(plan);
    const second = manager.installer.ensure(sibling);
    await bothAdmitted;
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({
      kind: 'ready',
      receipt: { assets: [{ fillCache: 'network' }] },
    });
    expect(secondResult).toMatchObject({
      kind: 'ready',
      receipt: { assets: [{ fillCache: 'tarball' }] },
    });
    expect(objectWrites).toBe(1);
  });

  it('replays and forwards object-flight progress to sibling sets and runtime readers', async () => {
    const { plan, tgz } = fixture();
    const sibling = siblingPlan(plan, '1.0.0');
    const readerPlan = siblingPlan(plan, '~1.0.0');
    let release!: () => void;
    let admitted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const assetSource = source(tgz);
    assetSource.acquire.mockImplementationOnce(async (requests) => {
      admitted();
      await gate;
      return requests.map((request: ShadowAssetSourceRequest) => ({
        request,
        bytes: tgz.slice(),
        fillTransport: 'standard' as const,
        fillCache: 'network' as const,
      }));
    });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: assetSource,
    });
    const leader = manager.installer.ensure(plan);
    await started;
    const siblingProgress: string[] = [];
    const readerProgress: string[] = [];
    const follower = manager.installer.ensure(sibling, {
      onProgress: (event) => siblingProgress.push(event.phase),
    });
    const read = manager.runtimeReader(readerPlan).readVerified('runtime', {
      onProgress: (event) => readerProgress.push(event.phase),
    });
    void read.catch(() => undefined);
    await Promise.resolve();
    release();

    await expect(Promise.all([leader, follower])).resolves.toHaveLength(2);
    await expect(read).resolves.toEqual(encoder.encode('runtime'));
    expect(assetSource.acquire).toHaveBeenCalledTimes(1);
    expect(siblingProgress).toEqual(['cache-check', 'fetch', 'verify', 'persist', 'ready']);
    expect(readerProgress).toEqual(['fetch', 'verify', 'persist']);
  });

  it('keeps the object flight visible until a delayed receipt publication admits late sibling sets', async () => {
    const { plan, tgz } = fixture();
    const substitutions = plan.substitutions.map((substitution) => ({
      ...substitution,
      requestedRange: '1.0.0',
    }));
    const sibling: ShadowAssetPlan = {
      requiredSetDigest: canonicalShadowDigest({ schema: 1, substitutions, assets: plan.assets }),
      substitutions,
      assets: plan.assets,
    };
    const inner = createMemoryShadowAssetStorage();
    let releaseReceipt!: () => void;
    let receiptStarted!: () => void;
    const receiptGate = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    const firstReceipt = new Promise<void>((resolve) => {
      receiptStarted = resolve;
    });
    let receiptWrites = 0;
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) => inner.read(entry),
      write: async (entry, bytes) => {
        if (entry.kind === 'receipt' && receiptWrites++ === 0) {
          receiptStarted();
          await receiptGate;
        }
        await inner.write(entry, bytes);
      },
      remove: (entry) => inner.remove(entry),
      inspect: () => inner.inspect(),
      clear: () => inner.clear(),
      close: () => inner.close(),
    };
    const assetSource = source(tgz);
    const manager = createShadowAssetManager({ storage, source: assetSource });

    const first = manager.installer.ensure(plan);
    await firstReceipt;
    const second = manager.installer.ensure(sibling);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseReceipt();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(assetSource.acquire).toHaveBeenCalledTimes(1);
  });

  it('re-shapes a shared object-flight failure to each required set', async () => {
    const { plan } = fixture();
    const substitutions = plan.substitutions.map((substitution) => ({
      ...substitution,
      requestedRange: '1.0.0',
    }));
    const sibling: ShadowAssetPlan = {
      requiredSetDigest: canonicalShadowDigest({ schema: 1, substitutions, assets: plan.assets }),
      substitutions,
      assets: plan.assets,
    };
    let release!: () => void;
    let admitted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const acquire = vi.fn(async () => {
      admitted();
      await gate;
      throw new Error('shared source failed');
    });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: { acquire, close: async () => undefined },
    });

    const first = manager.installer.ensure(plan);
    const second = manager.installer.ensure(sibling);
    await started;
    await Promise.resolve();
    release();
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);

    expect(firstResult).toMatchObject({
      status: 'rejected',
      reason: { code: 'ESHADOWASSET', requiredSetDigest: plan.requiredSetDigest },
    });
    expect(secondResult).toMatchObject({
      status: 'rejected',
      reason: { code: 'ESHADOWASSET', requiredSetDigest: sibling.requiredSetDigest },
    });
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('emits canonical progress after each boundary and isolates observer failure', async () => {
    const { plan, tgz } = fixture();
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(tgz),
    });
    const progress: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await manager.installer.ensure(plan, {
      onProgress: (event) => {
        progress.push(event.phase);
        if (event.phase === 'verify') throw new Error('observer fault');
      },
    });
    expect(progress).toEqual(['cache-check', 'fetch', 'verify', 'persist', 'ready']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('observer fault'));
    warn.mockRestore();
  });

  it('publishes temp, object, read-back, receipt, and ready in one acknowledged order', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    const events: string[] = [];
    let started = false;
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: async (entry) => {
        if (started) events.push(`read:${entry.kind}`);
        return await inner.read(entry);
      },
      write: async (entry, bytes) => {
        if (entry.kind === 'temp') started = true;
        if (started) events.push(`write:${entry.kind}`);
        await inner.write(entry, bytes);
      },
      remove: async (entry) => {
        if (started) events.push(`remove:${entry.kind}`);
        await inner.remove(entry);
      },
      inspect: () => inner.inspect(),
      clear: () => inner.clear(),
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({ storage, source: source(tgz) });
    await manager.installer.ensure(plan);
    expect(events).toEqual([
      'write:temp',
      'write:object',
      'read:object',
      'remove:temp',
      'write:receipt',
      'write:ready',
    ]);
  });

  it('rejects duplicate exact members without publishing an object or ready claim', async () => {
    const body = encoder.encode('runtime');
    const { plan, tgz } = fixture([
      { name: 'package/runtime.wasm', bytes: body },
      { name: 'package/runtime.wasm', bytes: body },
    ]);
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(tgz),
    });
    await expect(manager.installer.ensure(plan)).rejects.toBeInstanceOf(ShadowAssetError);
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
    expect(await manager.admin.inspectUsage()).toMatchObject({
      verifiedObjectCount: 0,
      readySetCount: 0,
    });
  });

  it('rejects PAX path metadata instead of extracting under the unoverridden header name', async () => {
    const body = encoder.encode('runtime');
    const { plan, tgz } = fixture([
      { name: 'PaxHeaders/runtime', bytes: encoder.encode('18 path=../escape\n'), type: 'x' },
      { name: 'package/runtime.wasm', bytes: body },
    ]);
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(tgz),
    });

    await expect(manager.installer.ensure(plan)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'verify',
    });
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
  });

  it.each([
    ['signal', { signal: {} }],
    ['onProgress', { onProgress: 1 }],
  ])('validates read option %s before touching storage', async (_label, value) => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    const read = vi.fn((entry: Parameters<ShadowAssetStorage['read']>[0]) => inner.read(entry));
    const manager = createShadowAssetManager({
      storage: { ...inner, read },
      source: source(tgz),
    });

    await expect(
      manager
        .runtimeReader(plan)
        .readVerified('runtime', value as unknown as ShadowAssetReadOptions),
    ).rejects.toBeInstanceOf(TypeError);
    expect(read).not.toHaveBeenCalled();
  });

  it('delivers joined ensure progress only to the scoped runtime-read observer', async () => {
    const { plan, tgz } = fixture();
    let release!: () => void;
    let admitted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const assetSource = source(tgz);
    assetSource.acquire.mockImplementationOnce(async (requests) => {
      admitted();
      await gate;
      return requests.map((request: ShadowAssetSourceRequest) => ({
        request,
        bytes: tgz.slice(),
        fillTransport: 'standard' as const,
        fillCache: 'network' as const,
      }));
    });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: assetSource,
    });
    const ensure = manager.installer.ensure(plan);
    await started;
    const progress: string[] = [];
    const read = manager.runtimeReader(plan).readVerified('runtime', {
      onProgress: (event) => progress.push(event.phase),
    });

    release();
    await expect(read).resolves.toEqual(encoder.encode('runtime'));
    await expect(ensure).resolves.toMatchObject({ kind: 'ready' });
    expect(progress).toEqual(['verify', 'persist', 'ready']);
  });

  it('never turns a failed ready-pointer acknowledgement into readiness', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) => inner.read(entry),
      write: async (entry, bytes) => {
        if (entry.kind === 'ready') throw new Error('ready acknowledgement failed');
        await inner.write(entry, bytes);
      },
      remove: (entry) => inner.remove(entry),
      inspect: () => inner.inspect(),
      clear: () => inner.clear(),
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({ storage, source: source(tgz) });
    await expect(manager.installer.ensure(plan)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'persist',
    });
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
  });

  it('quarantines a ready pointer whose write persisted before its acknowledgement failed', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    let failReadyAcknowledgement = true;
    let readyWrites = 0;
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) => inner.read(entry),
      write: async (entry, bytes) => {
        await inner.write(entry, bytes);
        if (entry.kind === 'ready') {
          readyWrites += 1;
          if (failReadyAcknowledgement) {
            failReadyAcknowledgement = false;
            throw new Error('ready acknowledgement failed after persistence');
          }
        }
      },
      remove: (entry) => inner.remove(entry),
      inspect: () => inner.inspect(),
      clear: () => inner.clear(),
      close: () => inner.close(),
    };
    const assetSource = source(tgz);
    const manager = createShadowAssetManager({ storage, source: assetSource });

    await expect(manager.installer.ensure(plan)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'persist',
    });
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
    await expect(manager.installer.ensure(plan)).resolves.toMatchObject({ kind: 'ready' });
    expect(readyWrites).toBe(2);
    expect(assetSource.acquire).toHaveBeenCalledTimes(1);
  });

  it.each(['source', 'storage'] as const)(
    're-shapes a forged public ShadowAssetError thrown by the %s adapter',
    async (boundary) => {
      const { plan, tgz } = fixture();
      const forged = new ShadowAssetError({
        message: 'forged adapter classification',
        requiredSetDigest: boundary === 'source' ? 'f'.repeat(64) : plan.requiredSetDigest,
        assetId: 'forged-asset',
        phase: 'ready',
        transports: [],
        recovery: 'none',
      });
      const inner = createMemoryShadowAssetStorage();
      let objectWritten = false;
      const storage: ShadowAssetStorage = {
        storageClass: inner.storageClass,
        read: (entry) => {
          if (boundary === 'storage' && objectWritten && entry.kind === 'object') {
            throw forged;
          }
          return inner.read(entry);
        },
        write: async (entry, bytes) => {
          await inner.write(entry, bytes);
          if (entry.kind === 'object') objectWritten = true;
        },
        remove: (entry) => inner.remove(entry),
        inspect: () => inner.inspect(),
        clear: () => inner.clear(),
        close: () => inner.close(),
      };
      const manager = createShadowAssetManager({
        storage,
        source:
          boundary === 'source'
            ? { acquire: async () => Promise.reject(forged), close: async () => undefined }
            : source(tgz),
      });

      let thrown: unknown;
      try {
        await manager.installer.ensure(plan);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        code: 'ESHADOWASSET',
        requiredSetDigest: plan.requiredSetDigest,
        phase: boundary === 'source' ? 'fetch' : 'persist',
        ...(boundary === 'storage' ? { assetId: 'runtime' } : {}),
        cause: forged,
      });
    },
  );

  it.each(['clear', 'close'] as const)(
    'lets an admitted runtime read settle before %s mutates its storage lifetime',
    async (operation) => {
      const { member, plan, tgz } = fixture();
      const inner = createMemoryShadowAssetStorage();
      let gateObjectReads = false;
      let release!: () => void;
      let admitted!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        admitted = resolve;
      });
      let clearCalled = false;
      let closeCalled = false;
      const storage: ShadowAssetStorage = {
        storageClass: inner.storageClass,
        read: async (entry) => {
          if (gateObjectReads && entry.kind === 'object') {
            admitted();
            await gate;
          }
          return await inner.read(entry);
        },
        write: (entry, bytes) => inner.write(entry, bytes),
        remove: (entry) => inner.remove(entry),
        inspect: () => inner.inspect(),
        clear: async () => {
          clearCalled = true;
          await inner.clear();
        },
        close: async () => {
          closeCalled = true;
          await inner.close();
        },
      };
      const manager = createShadowAssetManager({ storage, source: source(tgz) });
      await manager.installer.ensure(plan);
      const reader = manager.runtimeReader(plan);
      gateObjectReads = true;
      const read = reader.readVerified('runtime');
      void read.catch(() => undefined);
      await started;
      const settlement =
        operation === 'clear' ? manager.admin.clearCache().then(() => undefined) : manager.close();
      void settlement.catch(() => undefined);
      await Promise.resolve();
      const mutatedBeforeRead = operation === 'clear' ? clearCalled : closeCalled;
      release();

      expect(mutatedBeforeRead).toBe(false);
      await expect(read).resolves.toEqual(member);
      await expect(settlement).resolves.toBeUndefined();
    },
  );

  it('linearizes an admitted usage inspection before a later clear', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    let gateInspect = false;
    let release!: () => void;
    let admitted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    let clearCalled = false;
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) => inner.read(entry),
      write: (entry, bytes) => inner.write(entry, bytes),
      remove: (entry) => inner.remove(entry),
      inspect: async () => {
        if (gateInspect) {
          admitted();
          await gate;
        }
        return await inner.inspect();
      },
      clear: async () => {
        clearCalled = true;
        await inner.clear();
      },
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({ storage, source: source(tgz) });
    await manager.installer.ensure(plan);
    gateInspect = true;
    const inspect = manager.admin.inspectUsage();
    void inspect.catch(() => undefined);
    await started;
    const clearing = manager.admin.clearCache();
    void clearing.catch(() => undefined);
    await Promise.resolve();
    const clearedBeforeInspect = clearCalled;
    gateInspect = false;
    release();

    expect(clearedBeforeInspect).toBe(false);
    await expect(inspect).resolves.toMatchObject({
      verifiedObjectCount: 1,
      readySetCount: 1,
    });
    await expect(clearing).resolves.toMatchObject({ entryCount: 0, storedBytes: 0 });
  });

  it('binds readers to the exact plan and reports unknown assets', async () => {
    const { plan, tgz } = fixture();
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(tgz),
    });
    await expect(manager.runtimeReader(plan).readVerified('other')).rejects.toBeInstanceOf(
      ShadowAssetReadError,
    );
  });

  it('rejects an invalid receipt digest instead of reporting a semantic cache miss', async () => {
    const { tgz } = fixture();
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(tgz),
    });

    await expect(manager.installer.inspectReceipt('not-a-sha256')).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});
