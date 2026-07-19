import { RegistryClient, VfsTarballCache } from '@riftydev/npm-client';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { createWorkbenchShadowAssetSource } from './workbench-shadow-asset-source.ts';

const descriptor = builtinShadowAssetCatalog.assets[0];
if (descriptor === undefined) throw new Error('builtin shadow catalog requires one asset');
const request = Object.freeze({
  ...descriptor.source,
  maxTarballBytes: descriptor.maxTarballBytes,
});

function registryThatFails(calls: string[]): RegistryClient {
  return new RegistryClient({
    baseUrl: 'https://registry.example.invalid',
    maxRetries: 0,
    fetch: async (url) => {
      calls.push(url);
      return new Response('registry unavailable', { status: 503 });
    },
  });
}

describe('Workbench owner shadow-asset source composition', () => {
  it('keeps the exact standard source when Eddy is absent', async () => {
    const calls: string[] = [];
    const source = createWorkbenchShadowAssetSource({
      registry: registryThatFails(calls),
      tarballCache: new VfsTarballCache(new MemoryVfs()),
    });

    await expect(source.acquire([], { signal: new AbortController().signal })).resolves.toEqual([]);
    expect(calls).toEqual([]);
    await source.close();
  });

  it('selects Eddy first, logs its bounded failure, then uses the one standard fallback', async () => {
    const registryCalls: string[] = [];
    const eddyCalls: string[] = [];
    const warnings: string[] = [];
    const source = createWorkbenchShadowAssetSource({
      registry: registryThatFails(registryCalls),
      tarballCache: new VfsTarballCache(new MemoryVfs()),
      eddy: {
        resolverUrl: 'https://eddy.example.invalid/resolve',
        bundleBaseUrl: 'https://bundles.example.invalid',
      },
      fetchImpl: async (input) => {
        eddyCalls.push(String(input));
        return new Response('eddy unavailable', { status: 503 });
      },
      warn: (line) => warnings.push(line),
    });

    const failure = await source.acquire([request], { signal: new AbortController().signal }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect(eddyCalls).toEqual(['https://eddy.example.invalid/resolve']);
    expect(registryCalls).toEqual(['https://registry.example.invalid/esbuild-wasm']);
    expect(warnings).toEqual([
      expect.stringMatching(/Eddy unavailable, fallback to standard.*HTTP 503/i),
    ]);
    await source.close();
  });
});
