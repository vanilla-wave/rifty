import { describe, expect, it } from 'vitest';
import { canonicalEddyRequestKey } from './eddy-request.ts';
import {
  ShadowAssetSourceCollisionError,
  eddyRequestForShadowAssetSources,
} from './eddy-shadow-asset-request.ts';
import { createEddyShadowAssetSource } from './eddy-shadow-asset-source.ts';
import {
  assetFixture,
  eddyBundleFixture,
  realStandardSource,
  responseForBundle,
} from './eddy-shadow-asset-source.test-support.ts';

describe('Eddy shadow-asset source contract', () => {
  it('rejects a builtin trigger at construction before Eddy or STD can touch the wire', async () => {
    const asset = await assetFixture('esbuild', '0.28.0');
    const standard = realStandardSource(asset);
    const eddyCalls: string[] = [];

    expect(() =>
      createEddyShadowAssetSource({
        resolverUrl: 'https://eddy.test/resolve',
        sourceRequests: [asset.request],
        standardSource: standard.source,
        learnedPins: new Map(),
        fetchImpl: async (input) => {
          eddyCalls.push(String(input));
          return new Response(null, { status: 500 });
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        name: 'ShadowAssetSourceCollisionError',
        code: 'ESHADOWASSETSOURCE',
      }),
    );
    expect(eddyCalls).toEqual([]);
    expect(standard.calls).toEqual([]);
    expect(ShadowAssetSourceCollisionError).toBeDefined();
  });

  it('POSTs one canonical exact missing set, learns only durable proof, then replays with one GET', async () => {
    const zRuntime = await assetFixture('z-runtime', '2.0.0');
    const esbuildWasm = await assetFixture('esbuild-wasm', '0.28.0');
    const bundle = await eddyBundleFixture([esbuildWasm, zRuntime]);
    const standard = realStandardSource(esbuildWasm);
    const learnedPins = new Map<string, string>();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const source = createEddyShadowAssetSource({
      resolverUrl: 'https://eddy.test/resolve',
      bundleBaseUrl: 'https://eddy-cdn.test',
      sourceRequests: [zRuntime.request, esbuildWasm.request],
      standardSource: standard.source,
      learnedPins,
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init });
        return responseForBundle(bundle, calls.length === 1);
      },
    });
    const signal = new AbortController().signal;

    const cold = await source.acquire([zRuntime.request, esbuildWasm.request], { signal });
    const warm = await source.acquire([esbuildWasm.request, zRuntime.request], { signal });

    expect(cold).toHaveLength(2);
    expect(cold.map(({ request }) => request.name)).toEqual(['esbuild-wasm', 'z-runtime']);
    expect(cold.map(({ bytes }) => new TextDecoder().decode(bytes))).toEqual([
      new TextDecoder().decode(esbuildWasm.bytes),
      new TextDecoder().decode(zRuntime.bytes),
    ]);
    expect(cold.every((result) => result.fillTransport === 'eddy')).toBe(true);
    expect(cold.every((result) => result.fillCache === 'bundle')).toBe(true);
    expect(warm.map(({ bytes }) => bytes)).toEqual(cold.map(({ bytes }) => bytes));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://eddy.test/resolve');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBeNull();
    expect(String(calls[0]?.init?.body)).toBe(
      '{"dependencies":{"esbuild-wasm":"0.28.0","z-runtime":"2.0.0"},"optionalDependencies":{}}',
    );
    expect(calls[1]?.url).toBe(
      `https://eddy-cdn.test/bundle/${encodeURIComponent(bundle.closureHash)}`,
    );
    expect(calls[1]?.init?.method).toBeUndefined();
    expect(standard.calls).toEqual([]);
    const body = eddyRequestForShadowAssetSources([zRuntime.request, esbuildWasm.request]);
    expect(body).not.toBeNull();
    expect(learnedPins).toEqual(
      new Map([[canonicalEddyRequestKey(body!), bundle.closureHash]]),
    );
  });

  it('does not learn an unproved POST and never reuses a learned pin for another missing set', async () => {
    const first = await assetFixture('esbuild-wasm', '0.28.0');
    const second = await assetFixture('z-runtime', '2.0.0');
    const firstBundle = await eddyBundleFixture([first]);
    const secondBundle = await eddyBundleFixture([second]);
    const standard = realStandardSource(first);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const source = createEddyShadowAssetSource({
      resolverUrl: 'https://eddy.test/resolve',
      sourceRequests: [first.request, second.request],
      standardSource: standard.source,
      learnedPins: new Map(),
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init });
        const body = JSON.parse(String(init?.body)) as { dependencies: Record<string, string> };
        return responseForBundle(
          body.dependencies[first.request.name] ? firstBundle : secondBundle,
          calls.length === 1,
        );
      },
    });
    const signal = new AbortController().signal;

    await source.acquire([first.request], { signal });
    await source.acquire([second.request], { signal });
    await source.acquire([second.request], { signal });

    expect(calls.map(({ init }) => init?.method)).toEqual(['POST', 'POST', 'POST']);
  });

  it('closes atomically and idempotently', async () => {
    const asset = await assetFixture();
    const standard = realStandardSource(asset);
    const source = createEddyShadowAssetSource({
      resolverUrl: 'https://eddy.test/resolve',
      sourceRequests: [asset.request],
      standardSource: standard.source,
      learnedPins: new Map(),
      fetchImpl: async () => new Response(null, { status: 500 }),
    });

    await Promise.all([source.close(), source.close(), source.close()]);
    await expect(
      source.acquire([asset.request], { signal: new AbortController().signal }),
    ).rejects.toThrow(/closed/i);
  });
});
