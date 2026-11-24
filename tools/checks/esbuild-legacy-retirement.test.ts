import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_COORDINATION_SOURCES,
  ALLOWED_SHADOW_PRODUCTION_SOURCES,
  RETIRED_ESBUILD_PATHS,
  RETIRED_ESBUILD_REFERENCES,
  compilerOutputPin,
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

// Shape of the built worker (main 841fa5300): leading sibling-chunk imports, an own body
// above 2 MB, one hashed dynamic import. Runtime edits change only the sibling chunks.
const WORKER_HEADER = [
  'import {\n  installBundleLocalBuffer,\n  readKernelSyncApi\n} from "./chunk-S2ASLTLJ.js";\n',
  'import "./chunk-HXPMOJXM.js";\n',
  'import {\n  __commonJS,\n  __toESM\n} from "./chunk-2ESYSVXG.js";\n',
];
const WORKER_BODY = [
  '\n// node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js\n',
  'var require_typescript = __commonJS({ "typescript.js"(exports, module) {\n',
  '  var ts = {}; ts.version = "5.9.3";\n',
  '  ts.k = 0;\n'.repeat(200_000),
  '} });\nvar import_typescript = __toESM(require_typescript());\n',
  'installBundleLocalBuffer(); readKernelSyncApi();\n',
  'const { createModuleLoader } = await import("./module-loader-SE2E5KRJ.js");\n',
].join('');
const SIBLINGS = [
  'chunk-S2ASLTLJ.js',
  'chunk-HXPMOJXM.js',
  'chunk-2ESYSVXG.js',
  'chunk-KTR54RDO.js',
  'chunk-33QWLS3Y.js',
  'chunk-ONZOAA7V.js',
  'chunk-ABCDEFGH.js',
  'chunk-ABC.js',
  'module-loader-ABC.js',
  'module-loader-SE2E5KRJ.js',
  'module-loader-A575V22B.js',
];
const ASSETS = 'packages/workbench/dist/assets/';
const workerBytes = (header: readonly string[], body = WORKER_BODY) =>
  Buffer.from(header.join('') + body, 'latin1');
const WORKER_PINS = {
  'typescript-worker.js': {
    ...compilerOutputPin(workerBytes(WORKER_HEADER), new Set(SIBLINGS)),
    siblingImports: true,
  },
  'chunk-EMDIREKY.js': compilerOutputPin(Buffer.from(WORKER_BODY, 'latin1'), null),
};

function workerViolations(bytes: Buffer, name = 'typescript-worker.js'): string[] {
  return evaluateEsbuildBundleInventory(
    ROOT,
    [`${ASSETS}${name}`, ...SIBLINGS.map((sibling) => `${ASSETS}${sibling}`)],
    (path: string) => (path === `${ASSETS}${name}` ? bytes : Buffer.from('export {};\n')),
    WORKER_PINS,
  ).filter((violation: string) => !violation.startsWith('emitted generated esbuild client count'));
}

describe('esbuild carrier retirement', () => {
  it('pins the TypeScript worker as its body with sibling hashes zeroed', () => {
    const body = Buffer.from(WORKER_BODY.replace('SE2E5KRJ', '00000000'), 'latin1');
    expect(WORKER_PINS['typescript-worker.js']).toEqual({
      bytes: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'),
      siblingImports: true,
    });
  });

  it('keeps the TypeScript worker pin across runtime edits that only change sibling chunks', () => {
    expect(workerViolations(workerBytes(WORKER_HEADER))).toEqual([]);
    const renamed = [
      'import {\n  installBundleLocalBuffer,\n  readKernelSyncApi\n} from "./chunk-KTR54RDO.js";\n',
      'import "./chunk-33QWLS3Y.js";\n',
      'import "./chunk-ONZOAA7V.js";\n',
      'import {\n  __commonJS,\n  __toESM\n} from "./chunk-2ESYSVXG.js";\n',
    ];
    const reloaded = WORKER_BODY.replace('module-loader-SE2E5KRJ', 'module-loader-A575V22B');
    expect(workerViolations(workerBytes(renamed, reloaded))).toEqual([]);
    expect(workerViolations(workerBytes([WORKER_HEADER[0], WORKER_HEADER[2]]))).toEqual([]);
    const reordered = [
      'import {\n  __toESM,\n  __commonJS\n} from "./chunk-2ESYSVXG.js";\n',
      WORKER_HEADER[1],
      WORKER_HEADER[0],
    ];
    expect(workerViolations(workerBytes(reordered))).toEqual([]);
  });

  it('rejects any change to the TypeScript worker outside its sibling-chunk names', () => {
    const ceiling = [expect.stringContaining('2 MB carrier ceiling')];
    const spaced = (gap: string) =>
      `import {\n  installBundleLocalBuffer,${gap}\n  readKernelSyncApi\n} from "./chunk-S2ASLTLJ.js";\n`;
    const mutants = [
      [WORKER_HEADER, WORKER_BODY.replace('"5.9.3"', '"5.9.4"')],
      [WORKER_HEADER, `${WORKER_BODY}globalThis.extra = 1;\n`],
      [WORKER_HEADER, WORKER_BODY.replace('  ts.k = 0;\n', '')],
      [WORKER_HEADER, WORKER_BODY.replace('module-loader-SE2E5KRJ', 'esbuild-wasm-SE2E5KRJ')],
      // Hashed body name must be a built sibling.
      [WORKER_HEADER, WORKER_BODY.replace('module-loader-SE2E5KRJ', 'module-loader-NOPENOPE')],
      [WORKER_HEADER, WORKER_BODY.replace('module-loader-SE2E5KRJ', 'module-loader-ABC')],
      [[WORKER_HEADER[0], 'globalThis.extra = 1;\n', ...WORKER_HEADER.slice(1)], WORKER_BODY],
      // Exact esbuild form only: no free whitespace, no other spacing.
      [[spaced(' '.repeat(100_000)), ...WORKER_HEADER.slice(1)], WORKER_BODY],
      [[spaced('\t'), ...WORKER_HEADER.slice(1)], WORKER_BODY],
      [[spaced('\u00a0'), ...WORKER_HEADER.slice(1)], WORKER_BODY],
      [[WORKER_HEADER[0], 'import  "./chunk-HXPMOJXM.js";\n', WORKER_HEADER[2]], WORKER_BODY],
      [[...WORKER_HEADER, 'import { __toESM } from "./chunk-ABCDEFGH.js";\n'], WORKER_BODY],
      // Specifier: an existing `chunk-` sibling with an esbuild hash, once.
      [[...WORKER_HEADER, 'import "./chunk-NOPENOPE.js";\n'], WORKER_BODY],
      [[...WORKER_HEADER, 'import "./chunk-ABC.js";\n'], WORKER_BODY],
      [[...WORKER_HEADER, 'import "./module-loader-SE2E5KRJ.js";\n'], WORKER_BODY],
      [[...WORKER_HEADER, 'import "https://example.test/chunk-ABCDEFGH.js";\n'], WORKER_BODY],
      [[...WORKER_HEADER, WORKER_HEADER[1]], WORKER_BODY],
      // Bindings: identifiers used in the pinned body, each once.
      [[...WORKER_HEADER, 'import {\n  payloadAAAA\n} from "./chunk-ABCDEFGH.js";\n'], WORKER_BODY],
      [[...WORKER_HEADER, 'import {\n  __toESM\n} from "./chunk-ABCDEFGH.js";\n'], WORKER_BODY],
      [[...WORKER_HEADER, 'import {\n  ts.k\n} from "./chunk-ABCDEFGH.js";\n'], WORKER_BODY],
      [[...WORKER_HEADER, 'import {\n  a as ts\n} from "./chunk-ABCDEFGH.js";\n'], WORKER_BODY],
    ] as const;
    const admitted = mutants.flatMap(([header, body], index) =>
      workerViolations(workerBytes(header, body)).length === 0 ? [index] : [],
    );
    expect(admitted).toEqual([]);
    for (const [header, body] of mutants) {
      expect(workerViolations(workerBytes(header, body))).toEqual(ceiling);
    }
  });

  it('pins the other compiler output whole: a leading sibling import is red', () => {
    const compiler = Buffer.from(WORKER_BODY, 'latin1');
    expect(workerViolations(compiler, 'chunk-EMDIREKY.js')).toEqual([]);
    expect(
      workerViolations(
        Buffer.concat([Buffer.from(WORKER_HEADER[1]), compiler]),
        'chunk-EMDIREKY.js',
      ),
    ).toEqual([expect.stringContaining('2 MB carrier ceiling')]);
  });

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
      'packages/npm-client/src/internal/shadow/registry-projection.ts',
      'packages/npm-client/src/internal/shadow/runtime-tier.ts',
      'packages/npm-client/src/internal/shadow/schema-one-identity.ts',
      'packages/npm-client/src/internal/shadow/substitution.ts',
    ]);
    expect(ALLOWED_COORDINATION_SOURCES).toEqual([
      'packages/workbench/src/support/check-sandbox-support.ts',
      'packages/workbench/src/support/support-child.ts',
      'packages/workbench/src/support/support-worker.ts',
      'packages/workbench/src/support/types.ts',
      'packages/workbench/src/glue/vfs-snapshot-port.ts',
      'packages/workbench/src/workbench/service-worker-control.ts',
      'tools/shadow-registry/src/runtime/generated/esbuild-runtime.js',
      'packages/workbench/src/workers/no-coi-toolchain-owner.ts',
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
