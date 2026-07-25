import { type ShadowRuntimeAsset, shadowSha256 } from '@riftydev/shadow-registry/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  TAR_TRAILER,
  buildHeader,
  concat,
  gzip,
  padToBlock,
} from '../../_test-fixtures/tar-builder.ts';
import { RegistryClient } from '../../registry.ts';
import { computeIntegrity } from '../../tarball-cache.ts';
import { createRegistryShadowAssetSource } from './source.ts';

const encoder = new TextEncoder();
const member = encoder.encode('verified shadow member');
const memberPath = 'package/asset.wasm';

async function tarballFor(bytes = member): Promise<Uint8Array> {
  return await gzip(
    concat(buildHeader(memberPath, bytes.byteLength), padToBlock(bytes), TAR_TRAILER),
  );
}

function packument(integrity: string) {
  return {
    name: 'asset-pkg',
    versions: {
      '1.0.0': {
        name: 'asset-pkg',
        version: '1.0.0',
        dist: {
          tarball: 'https://registry.test/asset-pkg.tgz',
          integrity,
        },
      },
    },
  };
}

function descriptor(integrity: string, tarballBytes: number): ShadowRuntimeAsset {
  return {
    id: 'asset-pkg@1.0.0/package/asset.wasm',
    source: { name: 'asset-pkg', version: '1.0.0', integrity },
    member: memberPath,
    memberSha256: shadowSha256(member),
    memberSize: member.byteLength,
    maxTarballBytes: tarballBytes,
    maxUnpackedBytes: 4_096,
  };
}

describe('registry shadow asset source boundary', () => {
  it('verifies registry provenance, archive identity, and exact member bytes', async () => {
    const tarball = await tarballFor();
    const integrity = await computeIntegrity(tarball);
    const registry = new RegistryClient({
      baseUrl: 'https://registry.test',
      maxRetries: 0,
      fetch: async (url) =>
        url.endsWith('/asset-pkg')
          ? new Response(JSON.stringify(packument(integrity)))
          : new Response(tarball as unknown as BodyInit),
    });

    await expect(
      createRegistryShadowAssetSource(registry).acquire(
        descriptor(integrity, tarball.byteLength),
        new AbortController().signal,
      ),
    ).resolves.toEqual(member);
  });

  it('enforces the asset-specific compressed cap while draining the shared registry body', async () => {
    const tarball = await tarballFor();
    const integrity = await computeIntegrity(tarball);
    const registry = new RegistryClient({
      baseUrl: 'https://registry.test',
      maxRetries: 0,
      fetch: async (url) =>
        url.endsWith('/asset-pkg')
          ? new Response(JSON.stringify(packument(integrity)))
          : new Response(tarball as unknown as BodyInit),
    });

    await expect(
      createRegistryShadowAssetSource(registry).acquire(
        descriptor(integrity, tarball.byteLength - 1),
        new AbortController().signal,
      ),
    ).rejects.toThrow(`body exceeded ${tarball.byteLength - 1} bytes`);
  });

  it('propagates lifecycle abort through a stalled tarball drain', async () => {
    const tarball = await tarballFor();
    const integrity = await computeIntegrity(tarball);
    let markTarballStarted!: () => void;
    const tarballStarted = new Promise<void>((resolve) => {
      markTarballStarted = resolve;
    });
    const registry = new RegistryClient({
      baseUrl: 'https://registry.test',
      maxRetries: 0,
      stallTimeoutMs: 10_000,
      fetch: async (url) => {
        if (url.endsWith('/asset-pkg')) {
          return new Response(JSON.stringify(packument(integrity)));
        }
        markTarballStarted();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(tarball.slice(0, 1));
            },
          }),
        );
      },
    });
    const controller = new AbortController();
    const acquired = createRegistryShadowAssetSource(registry).acquire(
      descriptor(integrity, tarball.byteLength),
      controller.signal,
    );
    await tarballStarted;
    controller.abort(new Error('owner lifecycle closed'));

    await expect(acquired).rejects.toThrow('owner lifecycle closed');
  });

  it('cancels a stalled decompression read on owner lifecycle abort', async () => {
    const tarball = await tarballFor();
    const integrity = await computeIntegrity(tarball);
    const registry = new RegistryClient({
      baseUrl: 'https://registry.test',
      maxRetries: 0,
      fetch: async (url) =>
        url.endsWith('/asset-pkg')
          ? new Response(JSON.stringify(packument(integrity)))
          : new Response(tarball as unknown as BodyInit),
    });
    let markUnpackStarted!: () => void;
    const unpackStarted = new Promise<void>((resolve) => {
      markUnpackStarted = resolve;
    });
    const stalledDecompression = class {
      readonly readable = new ReadableStream<Uint8Array>({
        start() {
          markUnpackStarted();
        },
      });
      readonly writable = new WritableStream<BufferSource>();
    };
    vi.stubGlobal(
      'DecompressionStream',
      stalledDecompression as unknown as typeof DecompressionStream,
    );
    try {
      const controller = new AbortController();
      const acquired = createRegistryShadowAssetSource(registry).acquire(
        descriptor(integrity, tarball.byteLength),
        controller.signal,
      );
      await unpackStarted;
      controller.abort(new Error('owner lifecycle cleared during unpack'));

      await expect(acquired).rejects.toThrow('owner lifecycle cleared during unpack');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
