import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  PACKED_VITE_JOURNEYS,
  PACKED_WORKBENCH_EXPORTS,
  packedAliasBoundaryProof,
  packedAliasProofMatches,
  snapshotPackageNeedsRegistryTarball,
} from './workbench-packed-consumer-browser-contract.mjs';

const fixtureUrl = new URL('./fixtures/workbench-vite-consumer/src/main.ts', import.meta.url);
const runnerUrl = new URL('./workbench-packed-consumer.mjs', import.meta.url);
const aliasByteProofUrl = new URL(
  './fixtures/workbench-vite-consumer/alias-response-byte-proof.json',
  import.meta.url,
);

describe('packed Workbench browser acceptance contract', () => {
  it('uses all seven published exports from the clean external consumer', async () => {
    const fixture = await readFile(fixtureUrl, 'utf8');

    expect(PACKED_WORKBENCH_EXPORTS).toHaveLength(7);
    for (const specifier of PACKED_WORKBENCH_EXPORTS) {
      expect(fixture, `missing packed import ${specifier}`).toContain(specifier);
    }
  });

  it('runs exact Vite 7 and default Vite 8 Chromium dev/build/preview journeys', async () => {
    const [fixture, runner] = await Promise.all([
      readFile(fixtureUrl, 'utf8'),
      readFile(runnerUrl, 'utf8'),
    ]);

    expect(PACKED_VITE_JOURNEYS).toEqual([
      { version: '7.3.6', runtimeAssetCount: 1, hmr: true },
      { version: '8.0.16', runtimeAssetCount: 0, hmr: false },
    ]);
    expect(runner).toContain('PACKED_VITE_JOURNEYS');
    expect(runner).toContain('vite8-node-modules.json.gz');
    expect(fixture).toContain('runVite7BuildPreview');
    expect(fixture).toContain('runDefaultVite8');
    expect(fixture).toContain('waitForRenderedMarker');
    expect(fixture).toContain('openDefaultVite8');
    expect(fixture).toContain('vite8RuntimeAssetProgress');
  });

  it('holds the same tarball-installed production host for the cold benchmark route', async () => {
    const runner = await readFile(runnerUrl, 'utf8');

    expect(runner).toContain('--serve-shadow-asset-cold');
    expect(runner).toContain('shadow-asset-cold.html');
    expect(runner).toContain('RIFTY_SHADOW_ASSET_COLD_HOST=');
  });

  it('never republishes a synthesized snapshot delegate as a registry tarball', () => {
    expect(
      snapshotPackageNeedsRegistryTarball({
        version: '0.28.0',
        resolved: 'http://registry.test/esbuild-0.28.0.tgz',
        integrity: 'sha512-registry',
      }),
    ).toBe(true);
    expect(
      snapshotPackageNeedsRegistryTarball({
        version: '0.28.0',
        dependencies: {},
        rifty: {
          materialization: {
            protocol: 'rifty.lockfile-package-materialization/v1',
            kind: 'synthesized-shadow-delegate',
            substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
            recipeSha256: '6d98d08d0bcf2f25526e72d642d1e807090dc5bbf5fe3102372de4a069a3ad67',
          },
        },
      }),
    ).toBe(false);
    expect(() =>
      snapshotPackageNeedsRegistryTarball({
        version: '0.28.0',
        rifty: {
          materialization: {
            protocol: 'rifty.lockfile-package-materialization/v2',
            kind: 'synthesized-shadow-delegate',
          },
        },
      }),
    ).toThrow(/snapshot package materialization/i);
  });

  it('records exact response-body proof for the retired alias boundary', () => {
    const response = (packageName: string, kind: 'packument' | 'tarball', bodyBytes: number) => ({
      method: 'GET',
      path: `/${encodeURIComponent(packageName)}/${kind}`,
      packageName,
      kind,
      status: 200,
      bodyBytes,
    });
    expect(
      packedAliasBoundaryProof({
        registryOrigin: 'http://127.0.0.1:54321',
        responses: [
          response('vite', 'packument', 800),
          response('esbuild', 'packument', 612),
          response('esbuild-wasm', 'packument', 645),
          response('esbuild-wasm', 'tarball', 5_057_200),
        ],
      }),
    ).toEqual({
      schema: 2,
      registryOrigin: 'http://127.0.0.1:54321',
      responses: [
        response('vite', 'packument', 800),
        response('esbuild', 'packument', 612),
        response('esbuild-wasm', 'packument', 645),
        response('esbuild-wasm', 'tarball', 5_057_200),
      ],
      totalResponseBodyBytes: 5_059_257,
      publicEsbuild: {
        packument: { responses: 1, bodyBytes: 612 },
        tarball: { responses: 0, bodyBytes: 0 },
      },
      retiredAlias: {
        packument: { responses: 0, bodyBytes: 0 },
        tarball: { responses: 0, bodyBytes: 0 },
        totalBodyBytes: 0,
      },
      runtimeAssetSource: {
        packument: { responses: 1, bodyBytes: 645 },
        tarball: { responses: 1, bodyBytes: 5_057_200 },
      },
    });
  });

  it('pins the matched whole-journey before/after byte delta and complete ledgers', async () => {
    const measurement = JSON.parse(await readFile(aliasByteProofUrl, 'utf8'));
    const before = measurement.before.proof;
    const after = measurement.after.proof;
    const total = (responses: readonly { readonly bodyBytes: number }[]) =>
      responses.reduce((sum, response) => sum + response.bodyBytes, 0);
    const packageBytes = (
      responses: readonly { readonly packageName: string; readonly bodyBytes: number }[],
      packageName: string,
    ) =>
      responses
        .filter((response) => response.packageName === packageName)
        .reduce((sum, response) => sum + response.bodyBytes, 0);

    expect(measurement.boundary).toEqual({
      registryOrigin: 'http://127.0.0.1:54321',
      transport: 'standard',
      storageClass: 'memory-session',
      cacheRegime: 'fresh temp consumer and npm cache;fresh Chromium context',
      journey: 'cold open through preview and native HMR ready',
    });
    expect(total(before.responses)).toBe(before.totalResponseBodyBytes);
    expect(total(after.responses)).toBe(after.totalResponseBodyBytes);
    expect(
      packedAliasBoundaryProof({
        registryOrigin: measurement.boundary.registryOrigin,
        responses: after.responses,
      }),
    ).toEqual(after);
    expect(packageBytes(before.responses, '@esbuild/wasi-preview1')).toBe(5_057_827);
    expect(packageBytes(after.responses, '@esbuild/wasi-preview1')).toBe(0);
    expect(packageBytes(before.responses, 'esbuild')).toBe(0);
    expect(packageBytes(after.responses, 'esbuild')).toBe(3_913);
    expect(measurement.delta).toEqual({
      beforeResponseBodyBytes: 11_003_099,
      afterResponseBodyBytes: 5_949_185,
      removedResponseBodyBytes: 5_053_914,
      components: {
        retiredAliasRemoved: 5_057_827,
        publicEsbuildPackumentAdded: 3_913,
        otherResponseBodiesBefore: 5_945_272,
        otherResponseBodiesAfter: 5_945_272,
      },
    });
    expect(measurement.latency).toMatchObject({ status: 'unmeasured' });
  });

  it('binds the historical repacked alias SRI to its exact response paths', async () => {
    const measurement = JSON.parse(await readFile(aliasByteProofUrl, 'utf8'));
    expect(measurement.before.repackedAlias).toEqual({
      packageName: '@esbuild/wasi-preview1',
      version: '0.28.0',
      packumentPath: '/@esbuild%2Fwasi-preview1',
      tarballPath: '/-/tarballs/%40esbuild%2Fwasi-preview1-0.28.0.tgz',
      integrity:
        'sha512-OiVq6QwMpllcFsNXJMr4vpZMCVK5tJE5zRonRiBTgIMIYq1+9OJDFKk+DcFd/9r1jthZcO7Bk7maaVDZjG2DVg==',
    });
    const aliasResponses = measurement.before.proof.responses.filter(
      (response: { readonly packageName: string }) =>
        response.packageName === measurement.before.repackedAlias.packageName,
    );
    expect(aliasResponses).toEqual([
      expect.objectContaining({
        path: measurement.before.repackedAlias.packumentPath,
        kind: 'packument',
        status: 200,
        bodyBytes: 627,
      }),
      expect.objectContaining({
        path: measurement.before.repackedAlias.tarballPath,
        kind: 'tarball',
        status: 200,
        bodyBytes: 5_057_200,
      }),
    ]);
  });

  it('matches a complete response ledger independent of parallel completion order', () => {
    const response = (packageName: string, kind: 'packument' | 'tarball', bodyBytes: number) => ({
      method: 'GET',
      path: `/${encodeURIComponent(packageName)}/${kind}`,
      packageName,
      kind,
      status: 200,
      bodyBytes,
    });
    const responses = [
      response('vite', 'packument', 800),
      response('esbuild', 'packument', 612),
      response('esbuild-wasm', 'packument', 645),
      response('esbuild-wasm', 'tarball', 5_057_200),
    ];
    const expected = packedAliasBoundaryProof({
      registryOrigin: 'http://127.0.0.1:54321',
      responses,
    });
    const reordered = packedAliasBoundaryProof({
      registryOrigin: 'http://127.0.0.1:54321',
      responses: [responses[0], responses[1], responses[3], responses[2]],
    });
    const changed = packedAliasBoundaryProof({
      registryOrigin: 'http://127.0.0.1:54321',
      responses: [...responses.slice(0, -1), response('esbuild-wasm', 'tarball', 5_057_201)],
    });

    expect(packedAliasProofMatches(expected, reordered)).toBe(true);
    expect(packedAliasProofMatches(expected, changed)).toBe(false);
  });

  it.each([
    ['non-object', null],
    [
      'untracked POST',
      {
        method: 'POST',
        path: '/vite',
        packageName: 'vite',
        kind: 'packument',
        status: 200,
        bodyBytes: 800,
      },
    ],
    [
      'untracked response without a path',
      {
        method: 'GET',
        packageName: 'vite',
        kind: 'packument',
        status: 200,
        bodyBytes: 800,
      },
    ],
    [
      'untracked partial response',
      {
        method: 'GET',
        path: '/vite',
        packageName: 'vite',
        kind: 'packument',
        status: 206,
        bodyBytes: 800,
      },
    ],
  ])('refuses malformed %s instead of dropping it from the ledger', (_label, malformed) => {
    const required = [
      {
        method: 'GET',
        path: '/esbuild',
        packageName: 'esbuild',
        kind: 'packument',
        status: 200,
        bodyBytes: 612,
      },
      {
        method: 'GET',
        path: '/esbuild-wasm',
        packageName: 'esbuild-wasm',
        kind: 'packument',
        status: 200,
        bodyBytes: 645,
      },
      {
        method: 'GET',
        path: '/-/tarballs/esbuild-wasm-0.28.0.tgz',
        packageName: 'esbuild-wasm',
        kind: 'tarball',
        status: 200,
        bodyBytes: 5_057_200,
      },
    ];

    expect(() =>
      packedAliasBoundaryProof({
        registryOrigin: 'http://127.0.0.1:54321',
        responses: [...required, malformed],
      }),
    ).toThrow(/response|ledger|complete/i);
  });

  it('refuses a response-body total that exceeds the safe-integer boundary', () => {
    const required = [
      {
        method: 'GET',
        path: '/esbuild',
        packageName: 'esbuild',
        kind: 'packument',
        status: 200,
        bodyBytes: 612,
      },
      {
        method: 'GET',
        path: '/esbuild-wasm',
        packageName: 'esbuild-wasm',
        kind: 'packument',
        status: 200,
        bodyBytes: 645,
      },
      {
        method: 'GET',
        path: '/-/tarballs/esbuild-wasm-0.28.0.tgz',
        packageName: 'esbuild-wasm',
        kind: 'tarball',
        status: 200,
        bodyBytes: 5_057_200,
      },
      {
        method: 'GET',
        path: '/vite',
        packageName: 'vite',
        kind: 'packument',
        status: 200,
        bodyBytes: Number.MAX_SAFE_INTEGER,
      },
    ];

    expect(() =>
      packedAliasBoundaryProof({
        registryOrigin: 'http://127.0.0.1:54321',
        responses: required,
      }),
    ).toThrow(/safe integer|total/i);
  });

  it.each([
    ['alias packument survived', { packageName: '@esbuild/wasi-preview1', kind: 'packument' }],
    ['alias tarball survived', { packageName: '@esbuild/wasi-preview1', kind: 'tarball' }],
    ['public esbuild tarball survived', { packageName: 'esbuild', kind: 'tarball' }],
  ])('refuses when %s', (_label, forbidden) => {
    const required = [
      {
        method: 'GET',
        path: '/esbuild',
        packageName: 'esbuild',
        kind: 'packument',
        status: 200,
        bodyBytes: 612,
      },
      {
        method: 'GET',
        path: '/esbuild-wasm',
        packageName: 'esbuild-wasm',
        kind: 'packument',
        status: 200,
        bodyBytes: 645,
      },
      {
        method: 'GET',
        path: '/-/tarballs/esbuild-wasm-0.28.0.tgz',
        packageName: 'esbuild-wasm',
        kind: 'tarball',
        status: 200,
        bodyBytes: 5_057_200,
      },
    ];
    expect(() =>
      packedAliasBoundaryProof({
        registryOrigin: 'http://127.0.0.1:54321',
        responses: [
          ...required,
          {
            method: 'GET',
            path: '/forbidden',
            status: 200,
            bodyBytes: 1,
            ...forbidden,
          },
        ],
      }),
    ).toThrow(/forbidden|retired alias/i);
  });
});
