import { MemoryVfs } from '@riftydev/vfs';
import { closureHashOf } from './closure-hash.ts';
import {
  EDDY_BUNDLE_FORMAT,
  type EddyBundleSource,
  type EddyBundleTarballEntry,
  packEddyBundle,
} from './eddy-bundle.ts';
import type { Lockfile } from './linker.ts';
import { RegistryClient, type Fetcher, type Packument } from './registry.ts';
import { createStandardShadowAssetSource, type ShadowAssetSourceRequest } from './shadow-assets.ts';
import { VfsTarballCache, computeIntegrity } from './tarball-cache.ts';

export interface AssetFixture {
  readonly request: ShadowAssetSourceRequest;
  readonly bytes: Uint8Array;
}

export interface EddyBundleFixture {
  readonly bytes: Uint8Array;
  readonly closureHash: string;
  readonly contents: EddyBundleSource;
  readonly lockfile: Lockfile;
}

export async function assetFixture(
  name = 'esbuild-wasm',
  version = '0.28.0',
  body = `${name}@${version}:tarball-bytes`,
): Promise<AssetFixture> {
  const bytes = new TextEncoder().encode(body);
  return {
    bytes,
    request: {
      name,
      version,
      integrity: await computeIntegrity(bytes),
      maxTarballBytes: bytes.byteLength,
    },
  };
}

export async function eddyBundleFixture(
  assets: readonly AssetFixture[],
): Promise<EddyBundleFixture> {
  const dependencies: Record<string, string> = {};
  const packages: Lockfile['packages'] = {
    '': { version: '1.0.0', dependencies },
  };
  const entries: EddyBundleTarballEntry[] = [];
  for (const asset of assets) {
    dependencies[asset.request.name] = asset.request.version;
    packages[`node_modules/${asset.request.name}`] = {
      version: asset.request.version,
      resolved: `https://registry.test/${asset.request.name}-${asset.request.version}.tgz`,
      integrity: asset.request.integrity,
    };
    entries.push({
      file: `tarballs/${asset.request.name.replaceAll('/', '__')}-${asset.request.version}.tgz`,
      name: asset.request.name,
      version: asset.request.version,
      integrity: asset.request.integrity,
    });
  }
  const lockfile: Lockfile = {
    name: 'shadow-asset-closure',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages,
  };
  const closureHash = await closureHashOf(lockfile);
  const contents: EddyBundleSource = {
    manifest: {
      format: EDDY_BUNDLE_FORMAT,
      npmClientVersion: '0.1.0-test',
      asOf: {
        resolvedAt: '2026-07-19T00:00:00.000Z',
        registry: 'https://registry.test',
        closureHash,
      },
      tarballs: entries,
    },
    lockfileText: JSON.stringify(lockfile),
    tarballs: entries.map((entry, index) => ({
      entry,
      bytes: (assets[index] as AssetFixture).bytes,
    })),
  };
  return { bytes: packEddyBundle(contents), closureHash, contents, lockfile };
}

export function responseForBundle(
  fixture: EddyBundleFixture,
  durable = false,
): Response {
  return new Response(fixture.bytes.slice(), {
    status: 200,
    headers: durable ? { 'x-eddy-store-durable': '1' } : undefined,
  });
}

export function realStandardSource(
  asset: AssetFixture,
  outcome: 'success' | 'failure' = 'success',
) {
  const calls: string[] = [];
  const tarballUrl = `https://registry.test/${asset.request.name}-${asset.request.version}.tgz`;
  const packument: Packument = {
    name: asset.request.name,
    versions: {
      [asset.request.version]: {
        name: asset.request.name,
        version: asset.request.version,
        dist: { tarball: tarballUrl, integrity: asset.request.integrity },
      },
    },
  };
  const fetchImpl: Fetcher = async (url) => {
    calls.push(url);
    if (outcome === 'failure') return new Response(null, { status: 503 });
    if (url === `https://registry.test/${asset.request.name}`) {
      return new Response(JSON.stringify(packument), { status: 200 });
    }
    if (url === tarballUrl) return new Response(asset.bytes.slice(), { status: 200 });
    return new Response(null, { status: 404 });
  };
  const cache = new VfsTarballCache(new MemoryVfs());
  const registry = new RegistryClient({
    baseUrl: 'https://registry.test',
    fetch: fetchImpl,
    maxRetries: 0,
    stallTimeoutMs: 20,
  });
  return {
    cache,
    calls,
    source: createStandardShadowAssetSource({ registry, tarballCache: cache }),
  };
}
