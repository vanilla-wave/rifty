import { describe, expect, it } from 'vitest';
import { packEddyBundle } from './eddy-bundle.ts';
import { createEddyShadowAssetSource } from './eddy-shadow-asset-source.ts';
import {
  assetFixture,
  eddyBundleFixture,
  realStandardSource,
  responseForBundle,
} from './eddy-shadow-asset-source.test-support.ts';
import { computeIntegrity } from './tarball-cache.ts';

describe('Eddy shadow-asset source fault matrix', () => {
  it('falls back loudly to the real STD source and preserves truthful provenance', async () => {
    const asset = await assetFixture();
    const standard = realStandardSource(asset);
    const warnings: string[] = [];
    const source = createEddyShadowAssetSource({
      resolverUrl: 'https://eddy.test/resolve',
      sourceRequests: [asset.request],
      standardSource: standard.source,
      learnedPins: new Map(),
      fetchImpl: async () => new Response(null, { status: 503 }),
      warn: (line) => warnings.push(line),
    });

    const [result] = await source.acquire([asset.request], {
      signal: new AbortController().signal,
    });

    expect(result?.bytes).toEqual(asset.bytes);
    expect(result).toMatchObject({ fillTransport: 'standard', fillCache: 'network' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Eddy.*fallback.*standard.*HTTP 503/i);
    expect(standard.calls).toEqual([
      `https://registry.test/${asset.request.name}`,
      `https://registry.test/${asset.request.name}-${asset.request.version}.tgz`,
    ]);
  });

  it('throws one AggregateError naming both diagnoses when Eddy and STD fail', async () => {
    const asset = await assetFixture();
    const standard = realStandardSource(asset, 'failure');
    const warnings: string[] = [];
    const source = createEddyShadowAssetSource({
      resolverUrl: 'https://eddy.test/resolve',
      sourceRequests: [asset.request],
      standardSource: standard.source,
      learnedPins: new Map(),
      fetchImpl: async () => {
        throw new Error('resolver offline');
      },
      warn: (line) => warnings.push(line),
    });

    let thrown: unknown;
    try {
      await source.acquire([asset.request], { signal: new AbortController().signal });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(String(thrown)).toMatch(/Eddy.*standard/i);
    expect((thrown as AggregateError).errors).toHaveLength(2);
    expect(String((thrown as AggregateError).errors[0])).toMatch(/Eddy.*resolver offline/i);
    expect(String((thrown as AggregateError).errors[1])).toMatch(/standard.*503/i);
    expect(warnings).toHaveLength(1);
  });

  it.each(['partial', 'extra', 'corrupt'] as const)(
    '%s EddyBundleV1 declines before publishing bytes, then STD supplies the exact tarball',
    async (fault) => {
      const asset = await assetFixture();
      const valid = await eddyBundleFixture([asset]);
      const standard = realStandardSource(asset);
      const warnings: string[] = [];
      let bytes: Uint8Array;
      if (fault === 'partial') {
        bytes = packEddyBundle({ ...valid.contents, tarballs: [] });
      } else if (fault === 'extra') {
        const extraBytes = new TextEncoder().encode('unclaimed');
        bytes = packEddyBundle({
          ...valid.contents,
          tarballs: [
            ...valid.contents.tarballs,
            {
              entry: {
                file: 'tarballs/unclaimed-1.0.0.tgz',
                name: 'unclaimed',
                version: '1.0.0',
                integrity: await computeIntegrity(extraBytes),
              },
              bytes: extraBytes,
            },
          ],
        });
      } else {
        const corrupt = asset.bytes.slice();
        corrupt[0] = (corrupt[0] ?? 0) ^ 0xff;
        bytes = packEddyBundle({
          ...valid.contents,
          tarballs: [{ entry: valid.contents.tarballs[0]!.entry, bytes: corrupt }],
        });
      }
      const source = createEddyShadowAssetSource({
        resolverUrl: 'https://eddy.test/resolve',
        sourceRequests: [asset.request],
        standardSource: standard.source,
        learnedPins: new Map(),
        fetchImpl: async () => new Response(bytes.slice(), { status: 200 }),
        warn: (line) => warnings.push(line),
      });

      const [result] = await source.acquire([asset.request], {
        signal: new AbortController().signal,
      });

      expect(result?.bytes).toEqual(asset.bytes);
      expect(result).toMatchObject({ fillTransport: 'standard' });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/Eddy.*fallback.*standard/i);
    },
  );

  it('declines a learned GET whose bundle identity differs, without overwriting the pin', async () => {
    const asset = await assetFixture();
    const valid = await eddyBundleFixture([asset]);
    const standard = realStandardSource(asset);
    const expectedPin = 'sha256-expected-pin';
    const learnedPins = new Map<string, string>();
    const sourceBody = {
      dependencies: { [asset.request.name]: asset.request.version },
      optionalDependencies: {},
    };
    const { canonicalEddyRequestKey } = await import('./eddy-request.ts');
    learnedPins.set(canonicalEddyRequestKey(sourceBody), expectedPin);
    const calls: string[] = [];
    const source = createEddyShadowAssetSource({
      resolverUrl: 'https://eddy.test/resolve',
      sourceRequests: [asset.request],
      standardSource: standard.source,
      learnedPins,
      fetchImpl: async (input) => {
        calls.push(String(input));
        return responseForBundle(valid);
      },
      warn: () => undefined,
    });

    const [result] = await source.acquire([asset.request], {
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ fillTransport: 'standard' });
    expect(calls).toEqual([
      `https://eddy.test/resolve/bundle/${encodeURIComponent(expectedPin)}`,
    ]);
    expect(learnedPins.get(canonicalEddyRequestKey(sourceBody))).toBe(expectedPin);
  });

  it.each(['headers', 'body', 'oversize'] as const)(
    'bounds Eddy %s failure before falling back',
    async (phase) => {
      const asset = await assetFixture();
      const bundle = await eddyBundleFixture([asset]);
      const standard = realStandardSource(asset);
      const fetchImpl: typeof fetch = async () => {
        if (phase === 'headers') return await new Promise<Response>(() => undefined);
        if (phase === 'body') {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bundle.bytes.subarray(0, 512));
              },
            }),
            { status: 200 },
          );
        }
        return responseForBundle(bundle);
      };
      const source = createEddyShadowAssetSource({
        resolverUrl: 'https://eddy.test/resolve',
        sourceRequests: [asset.request],
        standardSource: standard.source,
        learnedPins: new Map(),
        fetchImpl,
        stallTimeoutMs: 5,
        maxBundleBytes: phase === 'oversize' ? bundle.bytes.byteLength - 1 : undefined,
        warn: () => undefined,
      });

      const [result] = await source.acquire([asset.request], {
        signal: new AbortController().signal,
      });

      expect(result).toMatchObject({ fillTransport: 'standard' });
    },
  );
});
