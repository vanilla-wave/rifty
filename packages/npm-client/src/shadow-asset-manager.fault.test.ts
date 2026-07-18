import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { canonicalShadowDigest, canonicalShadowJson } from './canonical-shadow-json.ts';
import {
  ShadowAssetError,
  type ShadowAssetPlan,
  type ShadowAssetSource,
  type ShadowAssetSourceRequest,
  type ShadowAssetSourceResult,
  type ShadowAssetStorage,
  ShadowAssetStoreError,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
} from './shadow-assets.ts';

const encoder = new TextEncoder();

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sri(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function tar(
  entries: readonly { name: string; bytes: Uint8Array; type?: string }[],
  trailer = true,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(512);
    header.set(encoder.encode(entry.name), 0);
    header.set(encoder.encode(entry.bytes.byteLength.toString(8).padStart(11, '0')), 124);
    header[135] = 0;
    header[156] = (entry.type ?? '0').charCodeAt(0);
    chunks.push(header, entry.bytes, new Uint8Array((512 - (entry.bytes.byteLength % 512)) % 512));
  }
  if (trailer) chunks.push(new Uint8Array(1024));
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function fixture(
  entries: readonly { name: string; bytes: Uint8Array; type?: string }[] = [
    { name: 'package/runtime.wasm', bytes: encoder.encode('runtime') },
  ],
  trailer = true,
) {
  const member = encoder.encode('runtime');
  const unpacked = tar(entries, trailer);
  const tgz = new Uint8Array(gzipSync(unpacked));
  const substitutions: ShadowAssetPlan['substitutions'] = [
    {
      catalog: { id: 'test.catalog', digest: '4'.repeat(64) },
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

function validResult(
  request: ShadowAssetSourceRequest,
  bytes: Uint8Array,
): ShadowAssetSourceResult {
  return {
    request,
    bytes: bytes.slice(),
    fillTransport: 'standard',
    fillCache: 'network',
  };
}

function source(
  acquire: ShadowAssetSource['acquire'],
  close: ShadowAssetSource['close'] = async () => undefined,
): ShadowAssetSource {
  return { acquire, close };
}

describe('ShadowAssetManager fault closure', () => {
  it('rejects a non-canonical required-set digest before source or storage mutation', async () => {
    const { plan, tgz } = fixture();
    const acquire = vi.fn(async (requests: readonly ShadowAssetSourceRequest[]) => [
      validResult(requests[0]!, tgz),
    ]);
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(acquire),
    });
    await expect(
      manager.installer.ensure({ ...plan, requiredSetDigest: 'f'.repeat(64) }),
    ).rejects.toThrow(/required-set digest/i);
    expect(acquire).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', (_request: ShadowAssetSourceRequest, _bytes: Uint8Array) => []],
    [
      'duplicate',
      (request: ShadowAssetSourceRequest, bytes: Uint8Array) => [
        validResult(request, bytes),
        validResult(request, bytes),
      ],
    ],
    [
      'extra',
      (request: ShadowAssetSourceRequest, bytes: Uint8Array) => [
        validResult(request, bytes),
        validResult({ ...request, name: 'extra' }, bytes),
      ],
    ],
    [
      'mismatched',
      (request: ShadowAssetSourceRequest, bytes: Uint8Array) => [
        validResult({ ...request, version: '2.0.0' }, bytes),
      ],
    ],
    [
      'oversize',
      (request: ShadowAssetSourceRequest, bytes: Uint8Array) => [
        validResult(request, new Uint8Array(bytes.byteLength + 1)),
      ],
    ],
  ])('rejects %s source-result closure before extraction/publication', async (_label, results) => {
    const { plan, tgz } = fixture();
    const storage = createMemoryShadowAssetStorage();
    const manager = createShadowAssetManager({
      storage,
      source: source(async (requests) => results(requests[0]!, tgz)),
    });
    await expect(manager.installer.ensure(plan)).rejects.toBeInstanceOf(ShadowAssetError);
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
    expect(await manager.admin.inspectUsage()).toMatchObject({
      verifiedObjectCount: 0,
      readySetCount: 0,
    });
  });

  it.each([
    ['missing member', [{ name: 'package/other.wasm', bytes: encoder.encode('runtime') }], true],
    [
      'unsafe path',
      [
        { name: '../escape', bytes: encoder.encode('bad') },
        { name: 'package/runtime.wasm', bytes: encoder.encode('runtime') },
      ],
      true,
    ],
    [
      'link member',
      [{ name: 'package/runtime.wasm', bytes: encoder.encode('runtime'), type: '2' }],
      true,
    ],
    [
      'truncated archive',
      [{ name: 'package/runtime.wasm', bytes: encoder.encode('runtime') }],
      false,
    ],
  ])('rejects %s without a ready claim', async (_label, entries, trailer) => {
    const { plan, tgz } = fixture(entries, trailer);
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(async (requests) => [validResult(requests[0]!, tgz)]),
    });
    await expect(manager.installer.ensure(plan)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'verify',
    });
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
  });

  it('reports persist quota facts without claiming readiness', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) => inner.read(entry),
      write: async (entry, bytes) => {
        if (entry.kind === 'temp') {
          throw Object.assign(new Error('quota exhausted'), {
            code: 'EDQUOT' as const,
            usedBytes: 8,
            requiredBytes: 16,
          });
        }
        await inner.write(entry, bytes);
      },
      remove: (entry) => inner.remove(entry),
      inspect: () => inner.inspect(),
      clear: () => inner.clear(),
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({
      storage,
      source: source(async (requests) => [validResult(requests[0]!, tgz)]),
    });

    await expect(manager.installer.ensure(plan)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'persist',
      recovery: 'clear-and-retry',
      usedBytes: 8,
      requiredBytes: 16,
    });
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
  });

  it('treats a poisoned object as a miss and self-heals through verified source bytes', async () => {
    const { member, plan, tgz } = fixture();
    const storage = createMemoryShadowAssetStorage();
    const acquire = vi.fn(async (requests: readonly ShadowAssetSourceRequest[]) => [
      validResult(requests[0]!, tgz),
    ]);
    const manager = createShadowAssetManager({ storage, source: source(acquire) });
    await manager.installer.ensure(plan);
    await storage.write(
      { kind: 'object', sha256: plan.assets[0]!.memberSha256 },
      encoder.encode('poison'),
    );
    await manager.installer.ensure(plan);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(await manager.runtimeReader(plan).readVerified('runtime')).toEqual(member);
  });

  it.each([
    'temp-write',
    'object-write',
    'object-read-back',
    'temp-remove',
    'receipt-write',
    'ready-write',
  ])('never claims readiness when %s acknowledgement fails', async (fault) => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    let objectWritten = false;
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: async (entry) => {
        if (fault === 'object-read-back' && entry.kind === 'object' && objectWritten) {
          throw new Error('storage object read-back acknowledgement failed');
        }
        return await inner.read(entry);
      },
      write: async (entry, bytes) => {
        if (
          (fault === 'temp-write' && entry.kind === 'temp') ||
          (fault === 'object-write' && entry.kind === 'object') ||
          (fault === 'receipt-write' && entry.kind === 'receipt') ||
          (fault === 'ready-write' && entry.kind === 'ready')
        ) {
          throw new Error(`storage ${fault} acknowledgement failed`);
        }
        await inner.write(entry, bytes);
        if (entry.kind === 'object') objectWritten = true;
      },
      remove: async (entry) => {
        if (fault === 'temp-remove' && entry.kind === 'temp') {
          throw new Error('storage temp-remove acknowledgement failed');
        }
        await inner.remove(entry);
      },
      inspect: () => inner.inspect(),
      clear: () => inner.clear(),
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({
      storage,
      source: source(async (requests) => [validResult(requests[0]!, tgz)]),
    });
    await expect(manager.installer.ensure(plan)).rejects.toMatchObject({
      code: 'ESHADOWASSET',
      phase: 'persist',
    });
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
  });

  it('cancels only one ensure waiter while the shared writer remains available', async () => {
    const { plan, tgz } = fixture();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const acquire = vi.fn(async (requests: readonly ShadowAssetSourceRequest[]) => {
      started();
      await gate;
      return [validResult(requests[0]!, tgz)];
    });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(acquire),
    });
    const abort = new AbortController();
    const cancelled = manager.installer.ensure(plan, { signal: abort.signal });
    const survivor = manager.installer.ensure(plan);
    await admitted;
    abort.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await expect(survivor).resolves.toMatchObject({ kind: 'ready' });
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('bounds a hung local read without damaging the verified manager state', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    let hangObjectReads = false;
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) =>
        hangObjectReads && entry.kind === 'object'
          ? new Promise<Uint8Array | null>(() => undefined)
          : inner.read(entry),
      write: (entry, bytes) => inner.write(entry, bytes),
      remove: (entry) => inner.remove(entry),
      inspect: () => inner.inspect(),
      clear: () => inner.clear(),
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({
      storage,
      source: source(async (requests) => [validResult(requests[0]!, tgz)]),
    });
    await manager.installer.ensure(plan);
    hangObjectReads = true;
    await expect(
      manager.runtimeReader(plan).readVerified('runtime', { deadlineMs: 5 }),
    ).rejects.toMatchObject({
      code: 'ESHADOWASSETREAD',
      reason: 'deadline',
      deadlineMs: 5,
    });
    hangObjectReads = false;
    await expect(manager.runtimeReader(plan).readVerified('runtime')).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });

  it('a joined read deadline removes only that waiter, not the admitted ensure', async () => {
    const { plan, tgz } = fixture();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
      source: source(async (requests) => {
        started();
        await gate;
        return [validResult(requests[0]!, tgz)];
      }),
    });
    const reader = manager.runtimeReader(plan);
    const ensure = manager.installer.ensure(plan);
    await admitted;
    await expect(reader.readVerified('runtime', { deadlineMs: 5 })).rejects.toMatchObject({
      code: 'ESHADOWASSETREAD',
      reason: 'deadline',
    });
    release();
    await expect(ensure).resolves.toMatchObject({ kind: 'ready' });
    await expect(reader.readVerified('runtime')).resolves.toEqual(encoder.encode('runtime'));
  });

  it('claims clear synchronously, fences new work, and linearizes inspect after acknowledgement', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) => inner.read(entry),
      write: (entry, bytes) => inner.write(entry, bytes),
      remove: (entry) => inner.remove(entry),
      inspect: () => inner.inspect(),
      clear: async () => {
        await gate;
        await inner.clear();
      },
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({
      storage,
      source: source(async (requests) => [validResult(requests[0]!, tgz)]),
    });
    await manager.installer.ensure(plan);
    const reader = manager.runtimeReader(plan);
    const clearing = manager.admin.clearCache();
    const inspecting = manager.admin.inspectUsage();
    await expect(manager.admin.clearCache()).rejects.toBeInstanceOf(ShadowAssetStoreError);
    await expect(manager.installer.ensure(plan)).rejects.toBeInstanceOf(ShadowAssetStoreError);
    await expect(reader.readVerified('runtime')).rejects.toBeInstanceOf(ShadowAssetStoreError);
    release();
    await expect(clearing).resolves.toMatchObject({ entryCount: 0, storedBytes: 0 });
    await expect(inspecting).resolves.toMatchObject({ entryCount: 0, storedBytes: 0 });
  });

  it('returns to open after clear failure and lets an admitted inspect observe retained state', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) => inner.read(entry),
      write: (entry, bytes) => inner.write(entry, bytes),
      remove: (entry) => inner.remove(entry),
      inspect: () => inner.inspect(),
      clear: async () => {
        await gate;
        throw new Error('clear acknowledgement failed');
      },
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({
      storage,
      source: source(async (requests) => [validResult(requests[0]!, tgz)]),
    });
    await manager.installer.ensure(plan);
    const clear = manager.admin.clearCache();
    const inspect = manager.admin.inspectUsage();
    release();
    await expect(clear).rejects.toMatchObject({ code: 'ESHADOWASSETSTORE', phase: 'clear' });
    await expect(inspect).resolves.toMatchObject({ verifiedObjectCount: 1, readySetCount: 1 });
    await expect(manager.installer.ensure(plan)).resolves.toMatchObject({ kind: 'ready' });
  });

  it('orders an inspect admitted during clear before a later close', async () => {
    const { plan, tgz } = fixture();
    const inner = createMemoryShadowAssetStorage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage: ShadowAssetStorage = {
      storageClass: inner.storageClass,
      read: (entry) => inner.read(entry),
      write: (entry, bytes) => inner.write(entry, bytes),
      remove: (entry) => inner.remove(entry),
      inspect: () => inner.inspect(),
      clear: async () => {
        await gate;
        await inner.clear();
      },
      close: () => inner.close(),
    };
    const manager = createShadowAssetManager({
      storage,
      source: source(async (requests) => [validResult(requests[0]!, tgz)]),
    });
    await manager.installer.ensure(plan);

    const clearing = manager.admin.clearCache();
    const inspecting = manager.admin.inspectUsage();
    const closing = manager.close();
    release();

    await expect(clearing).resolves.toMatchObject({ entryCount: 0, storedBytes: 0 });
    await expect(inspecting).resolves.toMatchObject({ entryCount: 0, storedBytes: 0 });
    await expect(closing).resolves.toBeUndefined();
  });

  it('aggregates source then storage close failures and returns one settlement', async () => {
    const storage = createMemoryShadowAssetStorage();
    const failingStorage: ShadowAssetStorage = {
      ...storage,
      close: async () => {
        throw new Error('storage close failed');
      },
    };
    const manager = createShadowAssetManager({
      storage: failingStorage,
      source: source(
        async () => [],
        async () => {
          throw new Error('source close failed');
        },
      ),
    });
    const first = manager.close();
    expect(manager.close()).toBe(first);
    let thrown: unknown;
    try {
      await first;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toHaveLength(2);
    expect((thrown as AggregateError).errors[0]).toBeInstanceOf(ShadowAssetStoreError);
    expect((thrown as AggregateError).errors[1]).toBeInstanceOf(ShadowAssetStoreError);
  });

  it('rejects a canonical receipt with an extra key and a poisoned object chain', async () => {
    const { plan, tgz } = fixture();
    const storage = createMemoryShadowAssetStorage();
    const manager = createShadowAssetManager({
      storage,
      source: source(async (requests) => [validResult(requests[0]!, tgz)]),
    });
    const result = await manager.installer.ensure(plan);
    if (result.kind !== 'ready') throw new Error('expected ready');
    await storage.write(
      { kind: 'receipt', sha256: result.receipt.receiptSha256 },
      encoder.encode(canonicalShadowJson({ ...result.receipt, extra: true })),
    );
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
    await storage.write(
      { kind: 'object', sha256: plan.assets[0]!.memberSha256 },
      encoder.encode('poison'),
    );
    expect(await manager.installer.inspectReceipt(plan.requiredSetDigest)).toBeNull();
  });
});
