import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_COORDINATION_SOURCES,
  ALLOWED_SHADOW_PRODUCTION_SOURCES,
  RETIRED_ESBUILD_PATHS,
  RETIRED_ESBUILD_REFERENCES,
  evaluateEsbuildBundleInventory,
  evaluateEsbuildLegacyRetirement,
  evaluateEsbuildPackagePacklists,
} from './esbuild-legacy-retirement.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GENERATED_CLIENT = readFileSync(
  new URL('../../packages/workbench/src/workers/generated/esbuild-runtime.js', import.meta.url),
  'utf8',
);

describe('esbuild carrier retirement', () => {
  it('keeps the deletion inventory finite', () => {
    expect(RETIRED_ESBUILD_PATHS).toEqual([
      'packages/npm-client/src/internal/shadow/manager.ts',
      'packages/npm-client/src/internal/shadow/port.ts',
      'packages/npm-client/src/internal/shadow/source.ts',
      'packages/workbench/src/workers/owner-shadow-assets.ts',
      'tests/integration/esbuild-wasi-transform.test.ts',
      'tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs',
      'tools/shadow-registry/src/esbuild-binding.ts',
      'tools/shadow-registry/src/esbuild-transform.test.ts',
      'tools/shadow-registry/src/esbuild-transform.ts',
      'tools/shadow-registry/vendor/esbuild-wasi-preview1/esbuild.wasm',
    ]);
    expect(RETIRED_ESBUILD_REFERENCES).toEqual([
      'KernelEntryCapabilityPorts',
      'OriginExclusiveShadowAssetManager',
      'PackageTreeShadowAssetBoundary',
      'SHADOW_ASSET_PORT_CAPABILITY',
      'ShadowAssetPlan',
      'ShadowAssetPortServer',
      'ShadowAssetReadySet',
      'ShadowAssetStorageClass',
      'ShadowAssetVfsDurability',
      'ShadowRuntimeAsset',
      '@riftydev/shadow-registry/esbuild-binding',
      '@riftydev/shadow-registry/esbuild-transform',
      'capabilityPorts',
      'consumeKernelEntryCapabilityPorts',
      'createMemoryShadowAssetStorage',
      'createOriginExclusiveShadowAssetManager',
      'createRegistryShadowAssetSource',
      'createShadowAssetPortClient',
      'createVfsShadowAssetStorage',
      'ESBUILD_WASM_VENDOR_PATH',
      'loadVendoredEsbuildWasm',
      'probeBrowserShadowAssetStorageClass',
      'shadowAssetPlanForInstallResult',
      'shadowAssets',
      'fetch-esbuild-wasi.mjs',
    ]);
    expect(ALLOWED_SHADOW_PRODUCTION_SOURCES).toEqual([
      'packages/npm-client/src/internal/shadow/admission.ts',
      'packages/npm-client/src/internal/shadow/index.ts',
      'packages/npm-client/src/internal/shadow/install-result.ts',
      'packages/npm-client/src/internal/shadow/planner.ts',
      'packages/npm-client/src/internal/shadow/schema-one-identity.ts',
      'packages/npm-client/src/internal/shadow/substitution.ts',
    ]);
    expect(ALLOWED_COORDINATION_SOURCES).toEqual([
      'packages/workbench/src/glue/vfs-snapshot-port.ts',
      'packages/workbench/src/workbench/service-worker-control.ts',
      'packages/workbench/src/workers/generated/esbuild-runtime.js',
      'packages/workbench/src/workers/no-coi-toolchain-worker.ts',
    ]);
  });

  it('keeps every vendored-WASI path and consumer deleted', () => {
    expect(evaluateEsbuildLegacyRetirement(ROOT)).toEqual([]);
  });

  it('reports both a retired path and a surviving consumer reference', () => {
    expect(
      evaluateEsbuildLegacyRetirement(
        '/repo',
        ['tools/shadow-registry/src/esbuild-binding.ts', 'consumer.ts'],
        {
          pathExists: (path) => path === 'tools/shadow-registry/src/esbuild-binding.ts',
          readTracked: (path) =>
            path === 'consumer.ts' ? 'loadVendoredEsbuildWasm();' : 'export {};',
        },
      ),
    ).toEqual([
      'tools/shadow-registry/src/esbuild-binding.ts: retired path still exists',
      'consumer.ts: retired reference "loadVendoredEsbuildWasm"',
    ]);
  });

  it('rejects the deleted public transform subpath', () => {
    expect(
      evaluateEsbuildLegacyRetirement('/repo', ['consumer.ts'], {
        pathExists: () => false,
        readTracked: () =>
          "import { transformWithEsbuildWasi } from '@riftydev/shadow-registry/esbuild-transform';",
      }),
    ).toEqual(['consumer.ts: retired reference "@riftydev/shadow-registry/esbuild-transform"']);
  });

  it('rejects retired machinery and a drifted generated client in emitted source maps', () => {
    const files = ['packages/workbench/dist/chunk.js.map'];
    const map = Buffer.from(
      JSON.stringify({
        sources: [
          '../src/workers/generated/esbuild-runtime.js',
          '../src/workers/renamed-runtime-broker.ts',
        ],
        sourcesContent: ['export const startEsbuildRuntime = 1;', 'createShadowAssetPortClient();'],
      }),
    );
    expect(evaluateEsbuildBundleInventory('/repo', files, () => map)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('retired emitted source token "createShadowAssetPortClient"'),
        expect.stringContaining('emitted generated esbuild client count is 0'),
      ]),
    );
  });

  it('rejects renamed or re-homed replacement machinery without relying on retired names', () => {
    expect(
      evaluateEsbuildLegacyRetirement(
        '/repo',
        [
          'packages/npm-client/src/internal/shadow/byte-vault.ts',
          'packages/workbench/src/workers/runtime-byte-broker.ts',
        ],
        {
          pathExists: () => false,
          readTracked: (path) =>
            path.includes('byte-vault')
              ? 'export class ByteVault { readonly entries = new Map<string, Uint8Array>(); }'
              : 'export class RuntimeByteBroker { constructor(readonly endpoint: MessagePort) {} send(key: string) { this.endpoint.postMessage({ key }); } }',
        },
      ),
    ).toEqual([
      'packages/npm-client/src/internal/shadow/byte-vault.ts: unapproved shadow production source',
      'packages/workbench/src/workers/runtime-byte-broker.ts: coordination source is outside the exact allowed inventory',
    ]);
  });

  it('rejects publish allowlist drift, copied clients, and compressed/base64 runtime bytes', () => {
    expect(
      evaluateEsbuildPackagePacklists('/repo', (path) => ({
        files:
          path === 'packages/workbench/package.json'
            ? ['dist', 'CHANGELOG.md', 'runtime-bytes']
            : ['dist', 'CHANGELOG.md'],
      })),
    ).toEqual([
      'packages/workbench/package.json: packed files must be exactly ["dist","CHANGELOG.md"]',
    ]);

    const copiedClientMap = Buffer.from(
      JSON.stringify({
        sources: [
          '../src/workers/generated/esbuild-runtime.js',
          '../src/workers/renamed-derived-client.js',
        ],
        sourcesContent: [GENERATED_CLIENT, GENERATED_CLIENT],
      }),
    );
    expect(
      evaluateEsbuildBundleInventory(
        '/repo',
        ['packages/workbench/dist/copied.js.map'],
        () => copiedClientMap,
      ),
    ).toContain('emitted generated esbuild client count is 2, expected 1');

    const wasm = readFileSync(
      new URL(
        '../../tools/shadow-registry/node_modules/esbuild-wasm/esbuild.wasm',
        import.meta.url,
      ),
    );
    const packed = Buffer.from(
      `export default ${JSON.stringify(gzipSync(wasm).toString('base64'))};`,
    );
    expect(
      evaluateEsbuildBundleInventory(
        '/repo',
        ['packages/workbench/dist/runtime-payload.js', 'packages/workbench/dist/client.js.map'],
        (path) =>
          path.endsWith('.js.map')
            ? Buffer.from(
                JSON.stringify({
                  sources: ['../src/workers/generated/esbuild-runtime.js'],
                  sourcesContent: [GENERATED_CLIENT],
                }),
              )
            : packed,
      ),
    ).toEqual(expect.arrayContaining([expect.stringContaining('packed runtime-byte candidate')]));
  });
});
