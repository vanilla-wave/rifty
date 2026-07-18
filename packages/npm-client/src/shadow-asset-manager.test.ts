import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  ShadowAssetError,
  ShadowAssetReadError,
  createMemoryShadowAssetStorage,
  createShadowAssetManager,
  type ShadowAssetPlan,
  type ShadowAssetSource,
  type ShadowAssetStorage,
} from './shadow-assets.ts';

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

function fixture(entries = [{ name: 'package/runtime.wasm', bytes: encoder.encode('runtime') }]) {
  const unpacked = tar(entries);
  const tgz = new Uint8Array(gzipSync(unpacked));
  const member = entries[0]?.bytes ?? new Uint8Array();
  const plan: ShadowAssetPlan = {
    requiredSetDigest: '1'.repeat(64),
    substitutions: [
      {
        catalog: { id: 'test.catalog', digest: '2'.repeat(64) },
        publicName: 'native-tool',
        requestedRange: '^1',
        resolvedPublicVersion: '1.0.0',
        substitutionId: 'test.substitution',
        runtimeAdapterId: 'test.adapter',
        builtin: true,
      },
    ],
    assets: [
      {
        id: 'runtime',
        source: { name: 'runtime-source', version: '1.0.0', integrity: sri(tgz) },
        member: 'package/runtime.wasm',
        memberSha256: sha256(member),
        memberSize: member.byteLength,
        maxTarballBytes: tgz.byteLength,
        maxUnpackedBytes: unpacked.byteLength,
      },
    ],
  };
  return { member, plan, tgz };
}

function source(bytes: Uint8Array): ShadowAssetSource & { acquire: ReturnType<typeof vi.fn> } {
  return {
    acquire: vi.fn(async (requests) =>
      requests.map((request) => ({
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
  it('publishes a verified receipt, serves owned bytes, and re-verifies a hit without source I/O', async () => {
    const { member, plan, tgz } = fixture();
    const assetSource = source(tgz);
    const manager = createShadowAssetManager({
      storage: createMemoryShadowAssetStorage(),
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
      return requests.map((request) => ({
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
});
