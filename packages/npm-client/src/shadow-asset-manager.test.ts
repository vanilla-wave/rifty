import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { canonicalShadowDigest } from './canonical-shadow-json.ts';
import { RegistryClient } from './registry.ts';
import {
  ShadowAssetError,
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
