import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RETIRED_ESBUILD_PATHS,
  RETIRED_ESBUILD_REFERENCES,
  evaluateEsbuildLegacyRetirement,
} from './esbuild-legacy-retirement.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('esbuild legacy retirement', () => {
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
  });

  it('keeps published recipe/runtime packages data-only by packlist', () => {
    for (const packageRoot of [
      'packages/npm-client',
      'packages/workbench',
      'tools/shadow-registry',
    ]) {
      const manifest = JSON.parse(readFileSync(`${ROOT}/${packageRoot}/package.json`, 'utf8')) as {
        readonly files?: unknown;
      };
      expect(manifest.files, packageRoot).toEqual(['dist', 'CHANGELOG.md']);
    }
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
});
