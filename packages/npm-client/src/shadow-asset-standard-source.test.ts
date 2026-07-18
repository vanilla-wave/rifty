import { createHash } from 'node:crypto';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it, vi } from 'vitest';
import { type Packument, RegistryClient } from './registry.ts';
import { type ShadowAssetSourceRequest, createStandardShadowAssetSource } from './shadow-assets.ts';
import { VfsTarballCache } from './tarball-cache.ts';

function integrity(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

class SourceRegistry extends RegistryClient {
  readonly getPackumentSpy = vi.fn<() => Promise<Packument>>();
  readonly getTarballSpy = vi.fn<(url: string, maxBytes?: number) => Promise<Uint8Array>>();

  constructor(packument: Packument, tarball: Uint8Array) {
    super({ baseUrl: '/unused', fetch: async () => new Response(null, { status: 500 }) });
    this.getPackumentSpy.mockResolvedValue(packument);
    this.getTarballSpy.mockResolvedValue(tarball);
  }

  override getPackument(_name: string): Promise<Packument> {
    return this.getPackumentSpy();
  }

  override getTarball(url: string, maxBytes?: number): Promise<Uint8Array> {
    return this.getTarballSpy(url, maxBytes);
  }
}

function setup(bytes = new TextEncoder().encode('tarball')) {
  const sri = integrity(bytes);
  const request: ShadowAssetSourceRequest = {
    name: 'runtime-source',
    version: '1.0.0',
    integrity: sri,
    maxTarballBytes: bytes.byteLength,
  };
  const packument: Packument = {
    name: request.name,
    versions: {
      [request.version]: {
        name: request.name,
        version: request.version,
        dist: { tarball: '/runtime-source.tgz', integrity: sri },
      },
    },
  };
  const registry = new SourceRegistry(packument, bytes);
  const cache = new VfsTarballCache(new MemoryVfs());
  const source = createStandardShadowAssetSource({ registry, tarballCache: cache });
  return { bytes, cache, packument, registry, request, source };
}

describe('standard shadow asset source', () => {
  it('uses a verified tarball-cache entry before registry metadata or network', async () => {
    const value = setup();
    await value.cache.put(
      value.request.name,
      value.request.version,
      value.request.integrity,
      value.bytes,
    );
    const [result] = await value.source.acquire([value.request], {
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ fillTransport: 'standard', fillCache: 'tarball' });
    expect(result?.bytes).toEqual(value.bytes);
    expect(value.registry.getPackumentSpy).not.toHaveBeenCalled();
    expect(value.registry.getTarballSpy).not.toHaveBeenCalled();
  });

  it('requires exact manifest identity/SRI and forwards the descriptor byte cap', async () => {
    const value = setup();
    const [result] = await value.source.acquire([value.request], {
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ fillTransport: 'standard', fillCache: 'network' });
    expect(value.registry.getTarballSpy).toHaveBeenCalledWith(
      '/runtime-source.tgz',
      value.request.maxTarballBytes,
    );

    const drift = setup();
    drift.packument.versions['1.0.0']!.dist.integrity = `sha512-${'A'.repeat(88)}`;
    await expect(
      drift.source.acquire([drift.request], { signal: new AbortController().signal }),
    ).rejects.toThrow(/integrity drift/);
  });

  it('rejects oversize cached bytes and malformed/unsorted request sets', async () => {
    const bytes = new TextEncoder().encode('oversize');
    const value = setup(bytes);
    const smaller = { ...value.request, maxTarballBytes: bytes.byteLength - 1 };
    await value.cache.put(smaller.name, smaller.version, smaller.integrity, bytes);
    await expect(
      value.source.acquire([smaller], { signal: new AbortController().signal }),
    ).rejects.toThrow(/exceeded/);
    await expect(
      value.source.acquire([value.request, value.request], {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/duplicate/);
  });

  it('rejects malformed SRI bytes before cache or registry work', async () => {
    const value = setup();
    const cacheRead = vi.spyOn(value.cache, 'get');

    await expect(
      value.source.acquire([{ ...value.request, integrity: 'sha512-not-base64' }], {
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(cacheRead).not.toHaveBeenCalled();
    expect(value.registry.getPackumentSpy).not.toHaveBeenCalled();
    expect(value.registry.getTarballSpy).not.toHaveBeenCalled();
  });
});
