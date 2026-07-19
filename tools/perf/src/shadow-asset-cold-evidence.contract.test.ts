import { describe, expect, it } from 'vitest';
import {
  buildEddyShadowAssetColdRun,
  buildStandardShadowAssetColdRun,
} from './shadow-asset-cold-evidence.mjs';

const ASSET_ID = 'esbuild-wasm@0.28.0/package/esbuild.wasm';
const DIGEST = 'a'.repeat(64);
const MEMBER_BYTES = 13_918_738;

interface TimedProgress {
  readonly atMs: number;
  readonly progress: Readonly<Record<string, unknown>>;
}

interface SourceResponse {
  readonly source: 'packument' | 'tarball' | 'eddy';
  readonly url: string;
  readonly protocol: string;
  readonly bodyBytes: number;
  readonly complete: boolean;
  readonly fromDiskCache: boolean;
  readonly fromServiceWorker: boolean;
  readonly fromPrefetchCache?: boolean;
  readonly requestServedFromCache?: boolean;
}

interface EvidenceFixture {
  readonly expected: {
    readonly assetId: string;
    readonly requiredSetDigest: string;
    readonly memberBytes: number;
  };
  readonly progress: readonly TimedProgress[];
  readonly openResolvedAtMs: number;
  readonly preInspection: Readonly<Record<string, unknown>>;
  readonly postInspection: Readonly<Record<string, unknown>>;
  readonly sourceResponses: readonly SourceResponse[];
  readonly cleanup: {
    readonly projectClosed: boolean;
    readonly workbenchClosed: boolean;
    readonly lockReacquired: boolean;
  };
}

interface EddySourceResponse {
  readonly requestId: string;
  readonly lifecycleId?: string;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly protocol: string;
  readonly bodyBytes: number;
  readonly complete: boolean;
  readonly fromDiskCache: boolean;
  readonly fromServiceWorker: boolean;
  readonly fromPrefetchCache?: boolean;
  readonly requestServedFromCache?: boolean;
}

interface EddyEvidenceFixture extends Omit<EvidenceFixture, 'expected' | 'sourceResponses'> {
  readonly expected: EvidenceFixture['expected'] & {
    readonly source: {
      readonly name: string;
      readonly version: string;
      readonly integrity: string;
    };
  };
  readonly endpoints: {
    readonly registryUrl: string;
    readonly resolverUrl: string;
    readonly bundleUrl: string;
  };
  readonly sourceResponses: readonly EddySourceResponse[];
}

function progress(atMs: number, phase: string): TimedProgress {
  return {
    atMs,
    progress:
      phase === 'ready'
        ? {
            phase,
            requiredSetDigest: DIGEST,
            assetCount: 1,
            storageClass: 'opfs-persisted',
          }
        : { phase, assetId: ASSET_ID, assetIndex: 0, assetCount: 1 },
  };
}

function fixture(overrides: Partial<EvidenceFixture> = {}): EvidenceFixture {
  return {
    expected: { assetId: ASSET_ID, requiredSetDigest: DIGEST, memberBytes: MEMBER_BYTES },
    progress: [
      progress(100, 'cache-check'),
      progress(110, 'fetch'),
      progress(140, 'verify'),
      progress(150, 'persist'),
      progress(160, 'ready'),
    ],
    openResolvedAtMs: 161,
    preInspection: {
      storageClass: 'opfs-persisted',
      entryCount: 0,
      storedBytes: 0,
      verifiedObjectCount: 0,
      verifiedObjectBytes: 0,
      readySetCount: 0,
    },
    postInspection: {
      storageClass: 'opfs-persisted',
      entryCount: 2,
      storedBytes: MEMBER_BYTES + 1_024,
      verifiedObjectCount: 1,
      verifiedObjectBytes: MEMBER_BYTES,
      readySetCount: 1,
    },
    sourceResponses: [
      {
        source: 'packument',
        url: 'https://registry.example/npm-registry/esbuild-wasm',
        protocol: 'h2',
        bodyBytes: 650,
        complete: true,
        fromDiskCache: false,
        fromServiceWorker: false,
      },
      {
        source: 'tarball',
        url: 'https://registry.example/npm-registry/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz',
        protocol: 'h2',
        bodyBytes: 5_057_200,
        complete: true,
        fromDiskCache: false,
        fromServiceWorker: false,
      },
    ],
    cleanup: { projectClosed: true, workbenchClosed: true, lockReacquired: true },
    ...overrides,
  };
}

function eddyResponse(overrides: Partial<EddySourceResponse> = {}): EddySourceResponse {
  return {
    requestId: 'worker\0eddy-1',
    method: 'POST',
    url: 'https://eddy.example/resolve',
    status: 200,
    protocol: 'h2',
    bodyBytes: 5_200_000,
    complete: true,
    fromDiskCache: false,
    fromServiceWorker: false,
    ...overrides,
  };
}

function eddyFixture(overrides: Partial<EddyEvidenceFixture> = {}): EddyEvidenceFixture {
  const common = fixture();
  return {
    ...common,
    expected: {
      ...common.expected,
      source: {
        name: 'esbuild-wasm',
        version: '0.28.0',
        integrity: 'sha512-canonical',
      },
    },
    endpoints: {
      registryUrl: 'https://registry.example/npm-registry',
      resolverUrl: 'https://eddy.example/resolve',
      bundleUrl: 'https://eddy-cdn.example/eddy-bundles',
    },
    sourceResponses: [eddyResponse()],
    ...overrides,
  };
}

describe('standard shadow-asset cold run evidence', () => {
  it('uses callback timestamps as the exact cache-check through ready sample', () => {
    expect(buildStandardShadowAssetColdRun(fixture())).toEqual({
      ok: true,
      run: {
        durationMs: 60,
        requiredSetDigest: DIGEST,
        storageClass: 'opfs-persisted',
        fillTransport: 'standard',
        fillCache: 'network',
        memberBytes: MEMBER_BYTES,
        responseBodyBytes: {
          packumentDecoded: 650,
          tarball: 5_057_200,
          total: 5_057_850,
        },
        transport: {
          mode: 'auto',
          origins: {
            'https://registry.example': { protocol: 'h2', requests: 2 },
          },
        },
      },
    });
  });

  it('accepts memory-session without persist but keeps the exact ordered boundary', () => {
    const input = fixture({
      progress: [
        progress(200, 'cache-check'),
        progress(210, 'fetch'),
        progress(230, 'verify'),
        {
          atMs: 240,
          progress: {
            phase: 'ready',
            requiredSetDigest: DIGEST,
            assetCount: 1,
            storageClass: 'memory-session',
          },
        },
      ],
      openResolvedAtMs: 241,
      preInspection: { ...fixture().preInspection, storageClass: 'memory-session' },
      postInspection: { ...fixture().postInspection, storageClass: 'memory-session' },
    });

    const result = buildStandardShadowAssetColdRun(input);
    expect(result).toMatchObject({
      ok: true,
      run: { durationMs: 40, storageClass: 'memory-session' },
    });
  });

  it.each([
    ['missing phase', ['cache-check', 'fetch', 'ready']],
    ['duplicate phase', ['cache-check', 'fetch', 'verify', 'verify', 'ready']],
    ['regressed phase', ['cache-check', 'verify', 'fetch', 'ready']],
    ['late phase', ['cache-check', 'fetch', 'verify', 'ready', 'persist']],
  ])('refuses %s with no inferred timing', (_name, phases) => {
    const result = buildStandardShadowAssetColdRun(
      fixture({ progress: phases.map((phase, index) => progress(100 + index * 10, phase)) }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(result).not.toHaveProperty('run');
  });

  it('refuses wrong/interleaved asset identity and a ready callback after open resolution', () => {
    const wrong = progress(110, 'fetch');
    const result = buildStandardShadowAssetColdRun(
      fixture({
        progress: [
          progress(100, 'cache-check'),
          { ...wrong, progress: { ...wrong.progress, assetId: 'foreign' } },
          progress(120, 'verify'),
          progress(130, 'ready'),
        ],
        openResolvedAtMs: 125,
      }),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it.each([
    [
      'dirty pre-state',
      fixture({ preInspection: { ...fixture().preInspection, verifiedObjectCount: 1 } }),
    ],
    [
      'wrong member bytes',
      fixture({ postInspection: { ...fixture().postInspection, verifiedObjectBytes: 10 } }),
    ],
    [
      'wrong ready-set count',
      fixture({ postInspection: { ...fixture().postInspection, readySetCount: 0 } }),
    ],
    [
      'mixed storage class',
      fixture({ postInspection: { ...fixture().postInspection, storageClass: 'memory-session' } }),
    ],
  ])('refuses storage proof: %s', (_name, input) => {
    expect(buildStandardShadowAssetColdRun(input)).toMatchObject({ ok: false });
  });

  it.each([
    ['missing tarball', fixture({ sourceResponses: [fixture().sourceResponses[0]!] })],
    [
      'tarball cache hit',
      fixture({
        sourceResponses: fixture().sourceResponses.map((response) =>
          response.source === 'tarball' ? { ...response, fromDiskCache: true } : response,
        ),
      }),
    ],
    [
      'Eddy fallback',
      fixture({
        sourceResponses: [
          ...fixture().sourceResponses,
          {
            source: 'eddy',
            url: 'https://eddy.example/',
            protocol: 'h2',
            bodyBytes: 100,
            complete: true,
            fromDiskCache: false,
            fromServiceWorker: false,
          },
        ],
      }),
    ],
    [
      'prefetch cache hit',
      fixture({
        sourceResponses: fixture().sourceResponses.map((response) => ({
          ...response,
          fromPrefetchCache: true,
        })),
      }),
    ],
    [
      'Network cache event',
      fixture({
        sourceResponses: fixture().sourceResponses.map((response) => ({
          ...response,
          requestServedFromCache: true,
        })),
      }),
    ],
    [
      'incomplete CDP body',
      fixture({
        sourceResponses: fixture().sourceResponses.map((response, index) =>
          index === 0 ? { ...response, complete: false } : response,
        ),
      }),
    ],
    [
      'unknown used protocol',
      fixture({
        sourceResponses: fixture().sourceResponses.map((response) => ({
          ...response,
          protocol: 'unknown',
        })),
      }),
    ],
    [
      'mixed protocol on one origin',
      fixture({
        sourceResponses: fixture().sourceResponses.map((response) => ({
          ...response,
          protocol: response.source === 'packument' ? 'h2' : 'h3',
        })),
      }),
    ],
  ])('refuses network provenance: %s', (_name, input) => {
    expect(buildStandardShadowAssetColdRun(input)).toMatchObject({ ok: false });
  });

  it.each(['projectClosed', 'workbenchClosed', 'lockReacquired'] as const)(
    'refuses the whole run when cleanup proof %s is false',
    (key) => {
      expect(
        buildStandardShadowAssetColdRun(
          fixture({ cleanup: { ...fixture().cleanup, [key]: false } }),
        ),
      ).toMatchObject({ ok: false });
    },
  );
});

describe('Eddy shadow-asset cold run evidence', () => {
  it('uses the same page boundary and proves one exact empty-pin resolver POST bundle', () => {
    expect(buildEddyShadowAssetColdRun(eddyFixture())).toEqual({
      ok: true,
      run: {
        durationMs: 60,
        requiredSetDigest: DIGEST,
        storageClass: 'opfs-persisted',
        fillTransport: 'eddy',
        fillCache: 'bundle',
        memberBytes: MEMBER_BYTES,
        responseBodyBytes: { bundle: 5_200_000, total: 5_200_000 },
        transport: {
          mode: 'auto',
          origins: {
            'https://eddy.example': { protocol: 'h2', requests: 1 },
          },
        },
      },
    });
  });

  it.each([
    [
      'dirty pre-state',
      eddyFixture({
        preInspection: { ...eddyFixture().preInspection, verifiedObjectCount: 1 },
      }),
    ],
    [
      'wrong progress sequence',
      eddyFixture({
        progress: [progress(100, 'cache-check'), progress(120, 'fetch'), progress(140, 'ready')],
      }),
    ],
    ['settlement before ready', eddyFixture({ openResolvedAtMs: 150 })],
    [
      'wrong exact object bytes',
      eddyFixture({
        postInspection: { ...eddyFixture().postInspection, verifiedObjectBytes: MEMBER_BYTES - 1 },
      }),
    ],
    [
      'failed cleanup',
      eddyFixture({
        cleanup: { ...eddyFixture().cleanup, lockReacquired: false },
      }),
    ],
  ])('refuses the same page/storage/progress/cleanup gap: %s', (_label, input) => {
    expect(buildEddyShadowAssetColdRun(input)).toMatchObject({ ok: false });
  });

  it.each([
    ['no response', []],
    ['retry', [eddyResponse(), eddyResponse({ requestId: 'worker\0eddy-2' })]],
    [
      'mixed Eddy and STD fallback',
      [
        eddyResponse(),
        eddyResponse({
          requestId: 'worker\0standard-1',
          method: 'GET',
          url: 'https://registry.example/npm-registry/esbuild-wasm',
          bodyBytes: 650,
        }),
      ],
    ],
    [
      'redirect lifecycle',
      [
        eddyResponse({ complete: false, status: 307 }),
        eddyResponse({ requestId: 'worker\0eddy-2', lifecycleId: 'eddy-1' }),
      ],
    ],
    ['incomplete body', [eddyResponse({ complete: false })]],
    ['non-2xx response', [eddyResponse({ status: 503 })]],
    ['zero-byte body', [eddyResponse({ bodyBytes: 0 })]],
    ['missing POST proof', [eddyResponse({ method: '' })]],
    ['learned-pin GET', [eddyResponse({ method: 'GET' })]],
    ['wrong resolver URL', [eddyResponse({ url: 'https://foreign.example/resolve' })]],
    ['unknown protocol', [eddyResponse({ protocol: 'unknown' })]],
    ['missing disk-cache proof', [eddyResponse({ fromDiskCache: undefined as never })]],
    ['missing service-worker proof', [eddyResponse({ fromServiceWorker: undefined as never })]],
    ['disk cache', [eddyResponse({ fromDiskCache: true })]],
    ['service worker cache', [eddyResponse({ fromServiceWorker: true })]],
    ['prefetch cache', [eddyResponse({ fromPrefetchCache: true })]],
    ['Network cache event', [eddyResponse({ requestServedFromCache: true })]],
  ])('refuses incomplete, mixed, or ambiguous Eddy provenance: %s', (_label, sourceResponses) => {
    const result = buildEddyShadowAssetColdRun(eddyFixture({ sourceResponses }));
    expect(result).toMatchObject({ ok: false });
    expect(result).not.toHaveProperty('run');
  });

  it.each([
    [
      'registry packument fallback',
      eddyResponse({
        method: 'GET',
        url: 'https://registry.example/npm-registry/esbuild-wasm',
        bodyBytes: 650,
      }),
    ],
    [
      'registry tarball fallback',
      eddyResponse({
        method: 'GET',
        url: 'https://registry.example/npm-registry/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz',
      }),
    ],
    [
      'configured bundle GET',
      eddyResponse({
        method: 'GET',
        url: 'https://eddy-cdn.example/eddy-bundles/bundle/sha256-cold-pin',
      }),
    ],
    [
      'foreign bundle GET',
      eddyResponse({
        method: 'GET',
        url: 'https://foreign.example/eddy-bundles/bundle/sha256-cold-pin',
      }),
    ],
  ])('refuses STD fallback or non-cold source traffic: %s', (_label, response) => {
    expect(buildEddyShadowAssetColdRun(eddyFixture({ sourceResponses: [response] }))).toMatchObject(
      {
        ok: false,
      },
    );
  });

  it.each([
    ['registry', { registryUrl: 'relative' }],
    ['resolver', { resolverUrl: 'file:///resolver' }],
    ['bundle', { bundleUrl: 'not a URL' }],
  ])('refuses an invalid configured %s endpoint before crediting the POST', (_label, endpoint) => {
    expect(
      buildEddyShadowAssetColdRun(
        eddyFixture({ endpoints: { ...eddyFixture().endpoints, ...endpoint } }),
      ),
    ).toMatchObject({ ok: false });
  });
});
