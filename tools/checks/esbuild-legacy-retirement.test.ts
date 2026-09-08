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
  new URL('../shadow-registry/src/runtime/generated/esbuild-runtime.js', import.meta.url),
  'utf8',
);

function assetViolations(name: string, bytes: Buffer): string[] {
  return evaluateEsbuildBundleInventory(
    ROOT,
    [`packages/workbench/dist/assets/${name}`],
    () => bytes,
  ).filter((violation: string) => !violation.startsWith('emitted generated esbuild client count'));
}

describe('esbuild carrier retirement', () => {
  it('admits only exact copied QuickJS and SQLite binaries', () => {
    for (const [name, source] of [
      [
        'quickjs.wasm',
        '../../packages/runtime-js/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm',
      ],
      ['sql-wasm.wasm', '../../packages/net/node_modules/sql.js/dist/sql-wasm.wasm'],
    ] as const) {
      const bytes = readFileSync(new URL(source, import.meta.url));
      expect(assetViolations(name, bytes)).toEqual([]);
      const corrupt = Buffer.from(bytes);
      corrupt[0] = 1;
      expect(assetViolations(name, corrupt)).toContainEqual(
        expect.stringContaining('runtime wasm shipped'),
      );
      expect(assetViolations(`renamed-${name}`, bytes)).toContainEqual(
        expect.stringContaining('runtime wasm shipped'),
      );
    }
  });

  it('rejects real esbuild bytes under admitted asset names in raw, gzip and base64 forms', () => {
    const wasm = readFileSync(
      new URL(
        '../../tools/shadow-registry/node_modules/esbuild-wasm/esbuild.wasm',
        import.meta.url,
      ),
    );
    expect(assetViolations('quickjs.wasm', wasm)).toContainEqual(
      expect.stringContaining('runtime wasm shipped'),
    );
    for (const bytes of [
      wasm,
      gzipSync(wasm),
      Buffer.from(`export default ${JSON.stringify(wasm.toString('base64'))};`),
      Buffer.from(`export default ${JSON.stringify(gzipSync(wasm).toString('base64'))};`),
    ]) {
      expect(assetViolations('typescript-worker.js', bytes).length).toBeGreaterThan(0);
    }
    expect(assetViolations('typescript-worker.js', Buffer.alloc(2_000_001, 'x'))).toContainEqual(
      expect.stringContaining('2 MB carrier ceiling'),
    );
  });

  it('admits the exact lexer literal while rejecting unknown adjacent inline WASM', () => {
    const source = readFileSync(
      new URL(
        '../../packages/runtime-js/node_modules/cjs-module-lexer/dist/lexer.mjs',
        import.meta.url,
      ),
      'utf8',
    );
    const literal = source.match(/AGFzbQ[A-Za-z0-9+/]*={0,2}/u)?.[0];
    expect(literal).toHaveLength(29_556);
    const allowed = `export const lexer = ${JSON.stringify(literal)};`;
    expect(assetViolations('lexer.js', Buffer.from(allowed))).toEqual([]);
    const unknown = 'export const unknown = "AGFzbQEAAAA=";';
    expect(assetViolations('lexer.js', Buffer.from(allowed + unknown))).toContainEqual(
      expect.stringContaining('inline WebAssembly base64 prefix'),
    );
  });

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
      'tools/shadow-registry/src/runtime/generated/esbuild-runtime.js',
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
          '../src/runtime/generated/esbuild-runtime.js',
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
          '../src/runtime/generated/esbuild-runtime.js',
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
                  sources: ['../src/runtime/generated/esbuild-runtime.js'],
                  sourcesContent: [GENERATED_CLIENT],
                }),
              )
            : packed,
      ),
    ).toEqual(expect.arrayContaining([expect.stringContaining('packed runtime-byte candidate')]));
  });
});
