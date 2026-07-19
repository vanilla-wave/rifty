import { MemoryVfs } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  RegistryClient,
  VfsTarballCache,
  createBuiltinEddyShadowAssetSource,
  createStandardShadowAssetSource,
} from './index.ts';

describe('public builtin Eddy shadow-asset source composition', () => {
  it('constructs through the package root and preserves the zero-miss zero-wire path', async () => {
    let requests = 0;
    const registry = new RegistryClient({
      baseUrl: 'https://registry.example.invalid',
      fetch: async () => {
        requests += 1;
        throw new Error('zero misses must not reach the registry');
      },
    });
    const standardSource = createStandardShadowAssetSource({
      registry,
      tarballCache: new VfsTarballCache(new MemoryVfs()),
    });
    const source = createBuiltinEddyShadowAssetSource({
      resolverUrl: 'https://eddy.example.invalid/resolve',
      standardSource,
      learnedPins: new Map(),
      fetchImpl: async () => {
        requests += 1;
        throw new Error('zero misses must not reach Eddy');
      },
    });

    await expect(source.acquire([], { signal: new AbortController().signal })).resolves.toEqual([]);
    expect(requests).toBe(0);
    await source.close();
  });
});
